// Black-box auth tests. They fire destructive requests (DELETE /data, POST /restore) at the
// server on purpose, so run them ONLY against the throwaway stack in docker-compose.test.yml
// (see the header there). Never point TEST_BASE_URL at a real instance.
//
//   TEST_PASSWORD=correct-horse-battery npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:13000';
const PASSWORD = process.env.TEST_PASSWORD;
// Must match SESSION_IDLE_TTL / SESSION_ABS_TTL in docker-compose.test.yml.
const IDLE_TTL = Number(process.env.TEST_IDLE_TTL || 4);
const ABS_TTL = Number(process.env.TEST_ABS_TTL || 9);

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  throw new Error(`Refusing to run destructive tests against ${BASE} (localhost only)`);
}
if (!PASSWORD) throw new Error('Set TEST_PASSWORD to the password used for TEST_APP_PASSWORD_HASH');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The backend trusts private-address proxies (the test client connects from one), so a unique X-Forwarded-For per call gives every request its
// own rate-limit bucket; tests that exercise the limiter pass a fixed `ip`.
let ipCounter = 0;
// Rate-limit tests need fixed IPs, but the limiter remembers them for 15 minutes — randomise per run
// so the suite can be re-run against the same stack.
const randomIp = () => `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
const nextIp = () => `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function call(method, url, { cookie, body, headers = {}, raw, ip, noCsrf } = {}) {
  const res = await fetch(BASE + url, {
    method,
    redirect: 'manual',
    headers: {
      ...(noCsrf ? {} : { 'X-Requested-With': 'pillpipe' }),
      'X-Forwarded-For': ip || nextIp(),
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie(), headers: res.headers };
}

async function login(password = PASSWORD, opts = {}) {
  const res = await call('POST', '/auth/login', { body: { password }, ...opts });
  const cookie = res.setCookie[0] ? res.setCookie[0].split(';')[0] : null;
  return { ...res, cookie };
}

// Query the throwaway test database (docker CLI; project/file must match docker-compose.test.yml).
function psql(sql) {
  return execFileSync('docker', [
    'compose', '-p', 'pillpipe-test', '-f', path.join(__dirname, '..', '..', 'docker-compose.test.yml'),
    'exec', '-T', 'db', 'psql', '-U', 'test', '-d', 'pillpipe_test', '-t', '-A', '-c', sql,
  ], { encoding: 'utf8', env: { ...process.env, TEST_APP_PASSWORD_HASH: process.env.TEST_APP_PASSWORD_HASH || 'x' } }).trim();
}

test('health is public', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { status: 'ok' });
});

test('every other route is 401 without a session (including unknown paths)', async () => {
  const routes = [
    ['GET', '/version'], ['GET', '/supplements'], ['POST', '/supplements'], ['GET', '/sessions'],
    ['GET', '/templates'], ['GET', '/backup'], ['POST', '/restore'], ['DELETE', '/data'],
    ['GET', '/settings/prefs'], ['PUT', '/settings/prefs'], ['GET', '/drive/status'],
    ['POST', '/drive/restore/abc'], ['GET', '/push/vapid-key'], ['POST', '/push/test'],
    ['GET', '/dose-log'], ['POST', '/dose-log'], ['GET', '/auth/google'],
    ['DELETE', '/auth/google'], ['POST', '/auth/logout'], ['POST', '/auth/logout-all'],
    ['GET', '/health/'], ['GET', '/nonexistent-' + Date.now()],
  ];
  for (const [method, url] of routes) {
    const res = await call(method, url, method === 'GET' ? {} : { body: {} });
    assert.equal(res.status, 401, `${method} ${url} should be 401, got ${res.status}`);
  }
});

test('the open-route allowlist is exactly the intended set', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
  const match = src.match(/const OPEN = new Set\(\[([^\]]*)\]\)/);
  assert.ok(match, 'OPEN allowlist not found in auth.js');
  const entries = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(entries, ['GET /auth/me', 'GET /health', 'HEAD /health', 'POST /auth/login']);
});

test('/auth/me reports unauthenticated without a cookie', async () => {
  const res = await call('GET', '/auth/me');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { authenticated: false });
});

test('wrong, empty, non-string and oversized passwords are rejected generically', async () => {
  for (const body of [{ password: 'wrong-password-123' }, { password: '' }, {}, { password: 12345 }, { password: 'x'.repeat(300) }]) {
    const res = await call('POST', '/auth/login', { body });
    assert.equal(res.status, 401);
    assert.deepEqual(res.json, { error: 'Invalid password' });
    assert.equal(res.setCookie.length, 0, 'no cookie on failure');
  }
});

test('malformed JSON and oversized bodies are 4xx, not 500', async () => {
  const bad = await call('POST', '/auth/login', { body: '{not json', raw: true, headers: { 'Content-Type': 'application/json' } });
  assert.equal(bad.status, 400);
  const big = await call('POST', '/auth/login', { body: { password: 'x'.repeat(5000) } });
  assert.equal(big.status, 413);
});

test('login sets a hardened cookie and grants access; logout revokes it', async () => {
  const res = await login();
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { authenticated: true });
  const attrs = res.setCookie[0];
  assert.match(attrs, /^pp_session=[A-Za-z0-9_-]{43};/);
  assert.match(attrs, /HttpOnly/);
  assert.match(attrs, /SameSite=Lax/);
  assert.match(attrs, /Path=\//);
  assert.match(attrs, new RegExp(`Max-Age=${ABS_TTL}`));
  assert.doesNotMatch(attrs, /Domain=/);

  assert.equal((await call('GET', '/supplements', { cookie: res.cookie })).status, 200);
  assert.deepEqual((await call('GET', '/auth/me', { cookie: res.cookie })).json, { authenticated: true });

  assert.equal((await call('POST', '/auth/logout', { cookie: res.cookie, body: {} })).status, 200);
  assert.equal((await call('GET', '/supplements', { cookie: res.cookie })).status, 401);
  assert.deepEqual((await call('GET', '/auth/me', { cookie: res.cookie })).json, { authenticated: false });
});

test('forged and unknown session cookies are rejected', async () => {
  for (const cookie of ['pp_session=garbage', 'pp_session=' + 'A'.repeat(43), 'pp_session=', 'other=1']) {
    assert.equal((await call('GET', '/supplements', { cookie })).status, 401, cookie);
  }
});

test('logout-all revokes every session', async () => {
  const a = await login();
  const b = await login();
  assert.equal((await call('POST', '/auth/logout-all', { cookie: a.cookie, body: {} })).status, 200);
  assert.equal((await call('GET', '/supplements', { cookie: a.cookie })).status, 401);
  assert.equal((await call('GET', '/supplements', { cookie: b.cookie })).status, 401);
});

test('POST /restore with an empty or malformed body is 400 and deletes nothing', async () => {
  const { cookie } = await login();
  const before = (await call('GET', '/supplements', { cookie })).json.length;
  assert.ok(before > 0, 'expected seed supplements from db/init.sql');
  const headers = { 'X-Confirm-Password': PASSWORD };
  for (const body of [{}, { supplements: 'nope' }, { version: 4, supplements: [], sessions: [], regimens: [], phases: [] }, []]) {
    const res = await call('POST', '/restore', { cookie, body, headers });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await call('GET', '/supplements', { cookie })).json.length, before);
});

test('a real restore works and does not log the owner out (auth_sessions survives TRUNCATE CASCADE)', async () => {
  const { cookie } = await login();
  const backup = await call('GET', '/backup', { cookie });
  assert.equal(backup.status, 200);
  const res = await call('POST', '/restore', { cookie, body: backup.json, headers: { 'X-Confirm-Password': PASSWORD } });
  assert.equal(res.status, 200, res.text);
  assert.equal((await call('GET', '/supplements', { cookie })).status, 200, 'session should survive the restore');
});

test('destructive routes require X-Confirm-Password: missing/wrong is rejected, correct works, wrong deletes nothing', async () => {
  const { cookie } = await login();
  const before = (await call('GET', '/supplements', { cookie })).json.length;
  const backup = (await call('GET', '/backup', { cookie })).json;

  // DELETE /data
  assert.equal((await call('DELETE', '/data', { cookie })).status, 400, 'missing header');
  assert.equal((await call('DELETE', '/data', { cookie, headers: { 'X-Confirm-Password': 'wrong-password' } })).status, 403, 'wrong password');
  assert.equal((await call('GET', '/supplements', { cookie })).json.length, before, 'nothing deleted by a rejected attempt');

  // POST /restore
  assert.equal((await call('POST', '/restore', { cookie, body: backup })).status, 400, 'missing header');
  assert.equal((await call('POST', '/restore', { cookie, body: backup, headers: { 'X-Confirm-Password': 'wrong-password' } })).status, 403, 'wrong password');
  assert.equal((await call('GET', '/supplements', { cookie })).json.length, before, 'nothing changed by a rejected attempt');

  // The correct password actually works (proves the gate isn't just always-reject)
  assert.equal((await call('DELETE', '/data', { cookie, headers: { 'X-Confirm-Password': PASSWORD } })).status, 200);
  assert.equal((await call('GET', '/supplements', { cookie })).json.length, 0, 'the correct password did delete');
});

test('DELETE /data leaves a pre-restore snapshot behind, capped so it never grows unbounded', async () => {
  const { cookie } = await login();
  const snapshotCount = () => Number(dc(
    'exec', 'db', 'psql', '-U', 'test', '-d', 'pillpipe_test', '-tAc', 'SELECT count(*) FROM pre_restore_snapshots'
  ).trim());
  const before = snapshotCount();
  await call('DELETE', '/data', { cookie, headers: { 'X-Confirm-Password': PASSWORD } });
  const after = snapshotCount();
  // Other tests in this run also trigger snapshots, so don't assume a clean slate — just that this
  // wipe added one (up to the cap) and pruning keeps it bounded (SNAPSHOT_KEEP in backup.js).
  assert.ok(after >= 1, 'at least one snapshot exists after a wipe');
  assert.ok(after <= 5, 'old snapshots are pruned, never unbounded');
  assert.ok(after === Math.min(before + 1, 5), 'grows by one until the cap, then holds steady');
});

test('idle sessions expire', async () => {
  const { cookie } = await login();
  assert.equal((await call('GET', '/supplements', { cookie })).status, 200);
  await sleep((IDLE_TTL + 1) * 1000);
  assert.equal((await call('GET', '/supplements', { cookie })).status, 401);
});

test('active sessions still hit the absolute expiry', async () => {
  const { cookie } = await login();
  const start = Date.now();
  let status = 200;
  while (status === 200 && Date.now() - start < (ABS_TTL + 4) * 1000) {
    await sleep(1000);
    status = (await call('GET', '/supplements', { cookie })).status;
  }
  const elapsed = (Date.now() - start) / 1000;
  assert.equal(status, 401, 'session should have expired');
  assert.ok(elapsed >= ABS_TTL - 1, `expired too early (${elapsed}s)`);
});

// ── Request hardening ─────────────────────────────────────────────────────────────────────────
function dc(...args) {
  return execFileSync('docker', [
    'compose', '-p', 'pillpipe-test', '-f', path.join(__dirname, '..', '..', 'docker-compose.test.yml'), ...args,
  ], { encoding: 'utf8', env: { ...process.env, TEST_APP_PASSWORD_HASH: process.env.TEST_APP_PASSWORD_HASH || 'x' } });
}
const oauthFailureLogs = () => (dc('logs', 'backend', '--no-color').match(/Google OAuth callback failed/g) || []).length;

test('state-changing requests need the CSRF header, a matching Origin and a same-origin fetch site', async () => {
  const { cookie } = await login();
  assert.equal((await call('POST', '/auth/login', { body: { password: PASSWORD }, noCsrf: true })).status, 403, 'login is protected too');
  assert.equal((await call('POST', '/auth/logout-all', { cookie, body: {}, noCsrf: true })).status, 403);
  assert.equal((await call('DELETE', '/data', { cookie, noCsrf: true })).status, 403);
  assert.equal((await call('POST', '/auth/logout', { cookie, body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('POST', '/auth/logout', { cookie, body: {}, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call('POST', '/auth/logout', { cookie, body: {}, headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
  // Rejected attempts must not have touched the session, and GETs need no header.
  assert.equal((await call('GET', '/supplements', { cookie, noCsrf: true })).status, 200);
  const ok = await call('POST', '/auth/logout', { cookie, body: {}, headers: { Origin: BASE, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(ok.status, 200);
});

test('login is rate limited per IP; only failures count; other IPs are unaffected', async () => {
  const ip = randomIp();
  for (let i = 0; i < 5; i++) assert.equal((await login('wrong-password-' + i, { ip })).status, 401);
  const blocked = await login(PASSWORD, { ip });
  assert.equal(blocked.status, 429, 'even the correct password is refused once the limit is hit');
  assert.equal(blocked.setCookie.length, 0);
  assert.equal((await login(PASSWORD, { ip: randomIp() })).status, 200);
});

test('behind the tunnel the limiter keys on the first public hop, not the proxy or a spoofed XFF', async () => {
  // Shape of X-Forwarded-For after Cloudflare → cloudflared (10.0.0.254) → NPM, with the client
  // prepending its own fake entries.
  const ip = randomIp();
  const via = (spoof) => `${spoof}, ${ip}, 10.0.0.254`;
  for (let i = 0; i < 5; i++) {
    assert.equal((await login('wrong-password-' + i, { ip: via(randomIp()) })).status, 401);
  }
  assert.equal((await login(PASSWORD, { ip: `${ip}, 10.0.0.254` })).status, 429);
  assert.equal((await login(PASSWORD, { ip: `${randomIp()}, 10.0.0.254` })).status, 200,
    'another internet client through the same tunnel is unaffected');
});

test('successful logins do not count toward the login limit', async () => {
  const ip = randomIp();
  for (let i = 0; i < 8; i++) assert.equal((await login(PASSWORD, { ip })).status, 200, `login ${i}`);
});

test('parallel login attempts beyond the scrypt concurrency cap get 429', async () => {
  const statuses = (await Promise.all(Array.from({ length: 8 }, () => login()))).map(r => r.status);
  assert.ok(statuses.includes(429), statuses.join());
  assert.ok(statuses.includes(200), statuses.join());
});

test('/restore accepts a large body; other routes keep the small default limit', async () => {
  const { cookie } = await login();
  const backup = (await call('GET', '/backup', { cookie })).json;
  const res = await call('POST', '/restore', { cookie, body: { ...backup, pad: 'x'.repeat(300000) }, headers: { 'X-Confirm-Password': PASSWORD } });
  assert.equal(res.status, 200, res.text);
  assert.equal((await call('PUT', '/settings/prefs', { cookie, body: { pad: 'x'.repeat(300000) } })).status, 413);
});

test('responses carry hardening headers and hide x-powered-by', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('Google callback without a session redirects back to the app instead of returning JSON', async () => {
  const res = await call('GET', '/auth/google/callback?code=x&state=y');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/?drive=error');
});

test('Google OAuth state is stored hashed, single-use and required', async () => {
  const { cookie } = await login();
  const issue = async () => {
    const start = await call('GET', '/auth/google', { cookie });
    assert.equal(start.status, 302);
    const url = new URL(start.headers.get('location'));
    assert.equal(url.host, 'accounts.google.com');
    const state = url.searchParams.get('state');
    assert.ok(state && state.length >= 30, 'state param present');
    return state;
  };
  const stored = state => Number(psql(`select count(*) from auth_sessions where oauth_state_hash = encode(digest('${state}','sha256'),'hex')`));
  const cb = async qs => {
    const res = await call('GET', `/auth/google/callback${qs}`, { cookie });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/?drive=error');
  };

  let state = await issue();
  assert.equal(stored(state), 1, 'sha256 of the state is stored');
  assert.equal(Number(psql(`select count(*) from auth_sessions where oauth_state_hash = '${state}'`)), 0, 'raw state is not stored');

  const before = oauthFailureLogs();
  await cb('?code=abc&state=not-the-state');
  assert.equal(oauthFailureLogs(), before, 'wrong state must be rejected before any token exchange');
  assert.equal(stored(state), 0, 'a wrong attempt still burns the stored state');

  state = await issue();
  await cb('?code=abc');
  assert.equal(oauthFailureLogs(), before, 'missing state must be rejected before any token exchange');

  state = await issue();
  await cb(`?code=abc&state=${state}`);
  assert.equal(oauthFailureLogs(), before + 1, 'matching state proceeds to the (fake, failing) token exchange');
  await cb(`?code=abc&state=${state}`);
  assert.equal(oauthFailureLogs(), before + 1, 'replayed state is rejected');
  assert.equal(Number(psql('select count(*) from google_tokens')), 0, 'nothing was stored');
});
