// Black-box auth tests. They fire destructive requests (DELETE /data, POST /restore) at the
// server on purpose, so run them ONLY against the throwaway stack in docker-compose.test.yml
// (see the header there). Never point TEST_BASE_URL at a real instance.
//
//   TEST_PASSWORD=correct-horse-battery npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

async function call(method, url, { cookie, body, headers = {}, raw } = {}) {
  const res = await fetch(BASE + url, {
    method,
    redirect: 'manual',
    headers: {
      'X-Requested-With': 'pillpipe',
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie() };
}

async function login(password = PASSWORD) {
  const res = await call('POST', '/auth/login', { body: { password } });
  const cookie = res.setCookie[0] ? res.setCookie[0].split(';')[0] : null;
  return { ...res, cookie };
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
    ['GET', '/dose-log'], ['POST', '/dose-log'], ['GET', '/auth/google'], ['GET', '/auth/google/callback'],
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
  for (const body of [{}, { supplements: 'nope' }, { version: 2, supplements: [], sessions: [], regimens: [], phases: [] }, []]) {
    const res = await call('POST', '/restore', { cookie, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await call('GET', '/supplements', { cookie })).json.length, before);
});

test('a real restore works and does not log the owner out (auth_sessions survives TRUNCATE CASCADE)', async () => {
  const { cookie } = await login();
  const backup = await call('GET', '/backup', { cookie });
  assert.equal(backup.status, 200);
  const res = await call('POST', '/restore', { cookie, body: backup.json });
  assert.equal(res.status, 200, res.text);
  assert.equal((await call('GET', '/supplements', { cookie })).status, 200, 'session should survive the restore');
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
