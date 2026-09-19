// Single-user password login with DB-backed sessions.
// - Every route is denied unless allowlisted below (fail closed, incl. unknown paths).
// - Session token = 32 random bytes in an HttpOnly cookie; only its SHA-256 is stored.
// - auth_sessions has no foreign keys so TRUNCATE ... CASCADE in restore never touches it.
const crypto = require('crypto');
const express = require('express');
const pool = require('./db');
const { parseHash, verifyPassword } = require('./password');

const positiveInt = (v, fallback) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

const COOKIE_SECURE = process.env.COOKIE_SECURE !== undefined
  ? process.env.COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production';
// The __Host- prefix requires Secure, so only use it when Secure is on.
const COOKIE_NAME = COOKIE_SECURE ? '__Host-pp_session' : 'pp_session';
const IDLE_TTL_S = positiveInt(process.env.SESSION_IDLE_TTL, 7 * 24 * 3600);
const ABS_TTL_S = positiveInt(process.env.SESSION_ABS_TTL, 30 * 24 * 3600);
// last_seen is only rewritten when older than this, so it must be well under the idle TTL.
const TOUCH_INTERVAL_S = Math.max(1, Math.min(60, Math.floor(IDLE_TTL_S / 4)));
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const ENV_HASH = (process.env.APP_PASSWORD_HASH || '').trim();
const PARSED_HASH = parseHash(ENV_HASH);
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
// Changing the password (new hash) invalidates every existing session.
const FINGERPRINT = sha256(ENV_HASH);

// Exact "METHOD /path" allowlist. Everything else needs a valid session.
const OPEN = new Set(['GET /health', 'HEAD /health', 'POST /auth/login', 'GET /auth/me']);

const w = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function setSessionCookie(res, value, maxAgeS) {
  const attrs = [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeS}`];
  if (COOKIE_SECURE) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id                  BIGSERIAL PRIMARY KEY,
      token_hash          TEXT NOT NULL UNIQUE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at          TIMESTAMPTZ NOT NULL,
      last_seen           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      pw_fingerprint      TEXT NOT NULL,
      oauth_state_hash    TEXT,
      oauth_state_expires TIMESTAMPTZ
    )
  `);
}

// Awaited before the server starts listening; throws (caller exits) on any problem.
async function init() {
  if (!PARSED_HASH) {
    throw new Error(
      'APP_PASSWORD_HASH is missing or invalid. Generate one with:\n' +
      '  docker compose run --rm backend node scripts/hash-password.js\n' +
      'then add the printed APP_PASSWORD_HASH=... line to .env'
    );
  }
  await ensureSchema();
  await purgeExpired();
}

async function purgeExpired() {
  await pool.query(
    `DELETE FROM auth_sessions
     WHERE expires_at < NOW()
        OR last_seen < NOW() - make_interval(secs => $1)
        OR pw_fingerprint <> $2`,
    [IDLE_TTL_S, FINGERPRINT]
  );
}

async function createSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO auth_sessions (token_hash, expires_at, pw_fingerprint)
     VALUES ($1, NOW() + make_interval(secs => $2), $3)`,
    [sha256(token), ABS_TTL_S, FINGERPRINT]
  );
  return token;
}

// Returns { id } for a valid session, else null. Throws on DB errors (callers must not fail open).
async function authenticate(req) {
  const token = getCookie(req, COOKIE_NAME);
  if (!token || !TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query(
    `SELECT id, (last_seen < NOW() - make_interval(secs => $4)) AS stale
       FROM auth_sessions
      WHERE token_hash = $1 AND pw_fingerprint = $2
        AND expires_at > NOW()
        AND last_seen > NOW() - make_interval(secs => $3)`,
    [sha256(token), FINGERPRINT, IDLE_TTL_S, TOUCH_INTERVAL_S]
  );
  if (!rows.length) return null;
  if (rows[0].stale) await pool.query('UPDATE auth_sessions SET last_seen = NOW() WHERE id = $1', [rows[0].id]);
  return { id: rows[0].id };
}

function gate(req, res, next) {
  if (OPEN.has(`${req.method} ${req.path}`)) return next();
  authenticate(req)
    .then(session => {
      if (!session) return res.status(401).json({ error: 'Authentication required' });
      req.authSession = session;
      next();
    })
    .catch(err => {
      console.error('Auth lookup failed:', err.message);
      res.status(503).json({ error: 'Service unavailable' });
    });
}

const router = express.Router();

router.post('/auth/login', express.json({ limit: '1kb' }), w(async (req, res) => {
  const password = req.body && req.body.password;
  const fail = () => {
    console.warn(`Failed login from ${req.ip}`);
    return res.status(401).json({ error: 'Invalid password' });
  };
  if (typeof password !== 'string' || !password || password.length > 256) return fail();
  if (!(await verifyPassword(password, PARSED_HASH))) return fail();
  await purgeExpired();
  setSessionCookie(res, await createSession(), ABS_TTL_S);
  res.json({ authenticated: true });
}));

router.get('/auth/me', w(async (req, res) => {
  res.json({ authenticated: !!(await authenticate(req)) });
}));

router.post('/auth/logout', w(async (req, res) => {
  await pool.query('DELETE FROM auth_sessions WHERE id = $1', [req.authSession.id]);
  setSessionCookie(res, '', 0);
  res.json({ authenticated: false });
}));

router.post('/auth/logout-all', w(async (req, res) => {
  await pool.query('DELETE FROM auth_sessions');
  setSessionCookie(res, '', 0);
  res.json({ authenticated: false });
}));

module.exports = { gate, router, init, purgeExpired, OPEN, COOKIE_NAME };
