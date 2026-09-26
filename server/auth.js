// Single-user password login with DB-backed sessions.
// - Every route is denied unless allowlisted below (fail closed, incl. unknown paths).
// - Session token = 32 random bytes in an HttpOnly cookie; only its SHA-256 is stored.
// - auth_sessions has no foreign keys so TRUNCATE ... CASCADE in restore never touches it.
// - Rate limits are per client IP (req.ip); index.js sets `trust proxy` to 1 hop, so this is only
//   meaningful when the backend is reachable solely through our reverse proxy (see docs/DEPLOY.md).
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('./db');
const { parseHash, verifyPassword } = require('./password');

const positiveInt = (v, fallback) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const LOGIN_MAX_FAILS = positiveInt(process.env.LOGIN_MAX_FAILS, 5);
const LOGIN_WINDOW_MS = positiveInt(process.env.LOGIN_WINDOW_S, 15 * 60) * 1000;
const API_RATE_LIMIT = positiveInt(process.env.API_RATE_LIMIT, 300); // requests / minute / IP
const APP_ORIGIN = (process.env.APP_ORIGIN || '').trim().replace(/\/$/, '');
const OAUTH_STATE_TTL = "interval '10 minutes'";
// scrypt at N=2^15 costs ~32 MiB + ~100 ms per attempt: cap parallel verifications so a login
// flood can't exhaust memory/CPU.
const MAX_CONCURRENT_VERIFY = 2;
// Under a distributed guessing attack, slow every failed login down instead of locking the
// owner out (a global lockout would be a denial-of-service lever).
const GLOBAL_FAIL_SLOWDOWN = positiveInt(process.env.LOGIN_SLOWDOWN_AFTER, 20);
const SLOWDOWN_MS = 1500;

const ENV_HASH = (process.env.APP_PASSWORD_HASH || '').trim();
const PARSED_HASH = parseHash(ENV_HASH);
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
// Changing the password (new hash) invalidates every existing session.
const FINGERPRINT = sha256(ENV_HASH);

// Exact "METHOD /path" allowlist. Everything else needs a valid session.
const OPEN = new Set(['GET /health', 'HEAD /health', 'POST /auth/login', 'GET /auth/me']);

let activeVerifications = 0;
let globalFails = 0;
setInterval(() => { globalFails = 0; }, LOGIN_WINDOW_MS).unref();

const w = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const tooMany = (req, res) => res.status(429).json({ error: 'Too many requests' });

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
  // Unlike APP_PASSWORD_HASH this doesn't fail closed (Tailscale-only/dev setups work fine without
  // it), but leaving it unset in production silently drops the Origin-header CSRF check — csrf()'s
  // `APP_ORIGIN && origin && ...` just no-ops. Warn loudly instead of failing silent.
  if (!APP_ORIGIN && process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: APP_ORIGIN is not set. The CSRF Origin-header check is disabled — only ' +
      "Sec-Fetch-Site and X-Requested-With defend state-changing requests. Set APP_ORIGIN to " +
      "this app's public URL (e.g. https://pill.example.com) before relying on it being internet-facing."
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

// ── OAuth state (binds the Google callback to the session that started it) ───────────────────
async function issueOAuthState(sessionId) {
  const state = crypto.randomBytes(24).toString('base64url');
  await pool.query(
    `UPDATE auth_sessions SET oauth_state_hash = $1, oauth_state_expires = NOW() + ${OAUTH_STATE_TTL} WHERE id = $2`,
    [sha256(state), sessionId]
  );
  return state;
}

// Single use: the stored state is cleared whether or not the supplied one matches.
async function consumeOAuthState(sessionId, state) {
  const { rows } = await pool.query(
    `WITH old AS (
       SELECT oauth_state_hash FROM auth_sessions
        WHERE id = $1 AND oauth_state_hash IS NOT NULL AND oauth_state_expires > NOW() FOR UPDATE
     )
     UPDATE auth_sessions s SET oauth_state_hash = NULL, oauth_state_expires = NULL
       FROM old WHERE s.id = $1
     RETURNING old.oauth_state_hash AS stored`,
    [sessionId]
  );
  if (!rows.length || typeof state !== 'string' || !state) return false;
  return crypto.timingSafeEqual(Buffer.from(rows[0].stored, 'hex'), Buffer.from(sha256(state), 'hex'));
}

// ── Middleware ─────────────────────────────────────────────────────────────────────────────────
// Cheap per-IP flood limit; runs before anything expensive.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: API_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: req => req.path === '/health',
  handler: tooMany,
});

// CSRF: cookies are SameSite=Lax, and every state-changing request must also carry a custom
// header (cross-origin pages can't add one without a CORS preflight, and CORS is not enabled).
function csrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const site = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;
  const forbidden = req.get('x-requested-with') !== 'pillpipe'
    || (site && site !== 'same-origin' && site !== 'none')
    || (APP_ORIGIN && origin && origin !== APP_ORIGIN);
  if (forbidden) return res.status(403).json({ error: 'Forbidden' });
  next();
}

function gate(req, res, next) {
  if (OPEN.has(`${req.method} ${req.path}`)) return next();
  authenticate(req)
    .then(session => {
      if (!session) {
        // The Google callback is a top-level browser navigation: send the user back to the app.
        if (req.method === 'GET' && req.path === '/auth/google/callback') return res.redirect('/?drive=error');
        return res.status(401).json({ error: 'Authentication required' });
      }
      req.authSession = session;
      next();
    })
    .catch(err => {
      console.error('Auth lookup failed:', err.message);
      res.status(503).json({ error: 'Service unavailable' });
    });
}

// ── Routes ─────────────────────────────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_MAX_FAILS,
  skipSuccessfulRequests: true, // only failures count toward the limit
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany,
});

const router = express.Router();

router.post('/auth/login', loginLimiter, express.json({ limit: '1kb' }), w(async (req, res) => {
  const password = req.body && req.body.password;
  // Under a guessing attack every failed response is delayed; a correct password never is.
  const fail = async () => {
    globalFails++;
    console.warn(`Failed login from ${req.ip}`);
    if (globalFails > GLOBAL_FAIL_SLOWDOWN) await sleep(SLOWDOWN_MS);
    return res.status(401).json({ error: 'Invalid password' });
  };
  if (typeof password !== 'string' || !password || password.length > 256) return fail();
  if (activeVerifications >= MAX_CONCURRENT_VERIFY) return tooMany(req, res);
  activeVerifications++;
  let ok;
  try {
    ok = await verifyPassword(password, PARSED_HASH);
  } finally {
    activeVerifications--;
  }
  if (!ok) return fail();
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

// Re-auth gate for destructive routes (DELETE /data, /supplements/:id, POST /restore,
// POST /drive/restore/:fileId): require the current password in an X-Confirm-Password header (a
// header, not the body, so it never has to share a shape with /restore's body — that's the backup
// file itself). Shares login's concurrency cap (scrypt is expensive) AND its global failed-attempt
// slowdown/logging — a stolen session cookie turns this into the same guessing-attack surface
// /auth/login is, not just a signed-in owner's typo.
async function requireCurrentPassword(req, res, next) {
  const password = req.get('x-confirm-password');
  const fail = async () => {
    globalFails++;
    console.warn(`Failed destructive-action re-auth from ${req.ip}`);
    if (globalFails > GLOBAL_FAIL_SLOWDOWN) await sleep(SLOWDOWN_MS);
    return res.status(403).json({ error: 'Incorrect password' });
  };
  if (typeof password !== 'string' || !password || password.length > 256) {
    return res.status(400).json({ error: 'X-Confirm-Password header is required for this action' });
  }
  if (activeVerifications >= MAX_CONCURRENT_VERIFY) return tooMany(req, res);
  activeVerifications++;
  let ok;
  try {
    ok = await verifyPassword(password, PARSED_HASH);
  } finally {
    activeVerifications--;
  }
  if (!ok) return fail();
  next();
}

module.exports = {
  apiLimiter, csrf, gate, router, requireCurrentPassword,
  init, purgeExpired, issueOAuthState, consumeOAuthState,
  OPEN, COOKIE_NAME,
};
