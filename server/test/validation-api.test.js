// Black-box tests for request-body validation (server/validation.js). Run ONLY against the
// throwaway stack in docker-compose.test.yml.
//
//   TEST_PASSWORD=correct-horse-battery npm test
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:13000';
const PASSWORD = process.env.TEST_PASSWORD;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  throw new Error(`Refusing to run destructive tests against ${BASE} (localhost only)`);
}
if (!PASSWORD) throw new Error('Set TEST_PASSWORD to the password used for TEST_APP_PASSWORD_HASH');

let ipCounter = 0;
const nextIp = () => `10.40.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function call(method, url, { cookie, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'X-Requested-With': 'pillpipe',
      'X-Forwarded-For': nextIp(),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

async function login() {
  const res = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'pillpipe', 'X-Forwarded-For': nextIp() },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(res.status, 200, 'login');
  return res.headers.getSetCookie()[0].split(';')[0];
}

const validSupplement = { name: 'V', pills_per_bottle: 60, price: 10, type: 'maintenance', current_inventory: 20, unit: 'capsules' };

test('POST /supplements rejects bad bodies with a clean 400, not a DB error', async () => {
  const cookie = await login();
  for (const body of [
    { ...validSupplement, name: '' },              // required, non-empty
    { ...validSupplement, name: undefined },        // required
    { ...validSupplement, type: 'not-a-real-type' }, // DB CHECK constraint, but should never reach it
    { ...validSupplement, price: -5 },              // negative
    { ...validSupplement, price: 'ten' },            // wrong type
    { ...validSupplement, pills_per_bottle: NaN },
    { ...validSupplement, take_with_food: 'yes' },   // must be boolean
  ]) {
    const res = await call('POST', '/supplements', { cookie, body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.json?.error, 'has an error message');
    assert.ok(!res.json.error.match(/relation|syntax error|constraint/i), 'never leaks a raw DB error');
  }
  // Sanity: the valid shape these bad ones were derived from still works.
  assert.equal((await call('POST', '/supplements', { cookie, body: validSupplement })).status, 201);
});

test('PATCH /supplements/:id rejects a non-numeric current_inventory', async () => {
  const cookie = await login();
  const supp = (await call('POST', '/supplements', { cookie, body: validSupplement })).json;
  const res = await call('PATCH', `/supplements/${supp.id}`, { cookie, body: { current_inventory: 'lots' } });
  assert.equal(res.status, 400);
});

test('PUT /supplements/:id preserves fields a partial body omits, instead of zeroing/resetting them', async () => {
  const cookie = await login();
  const supp = (await call('POST', '/supplements', { cookie, body: { ...validSupplement, current_inventory: 42, reorder_threshold: 5, reorder_threshold_mode: 'days' } })).json;
  // Only the required fields — everything else (current_inventory, unit, reorder_threshold*, take_with_food) omitted.
  const res = await call('PUT', `/supplements/${supp.id}`, { cookie, body: { name: 'V', pills_per_bottle: 60, price: 10, type: 'maintenance' } });
  assert.equal(res.status, 200, res.text);
  assert.equal(Number(res.json.current_inventory), 42, 'omitted current_inventory must not zero it');
  assert.equal(res.json.unit, 'capsules', 'omitted unit must not reset it');
  assert.equal(Number(res.json.reorder_threshold), 5, 'omitted reorder_threshold must not clear it');
  assert.equal(res.json.reorder_threshold_mode, 'days', 'omitted reorder_threshold_mode must not reset it');

  // Explicit null on reorder_threshold still clears it (real behavior the UI depends on).
  const cleared = await call('PUT', `/supplements/${supp.id}`, { cookie, body: { name: 'V', pills_per_bottle: 60, price: 10, type: 'maintenance', reorder_threshold: null } });
  assert.equal(cleared.json.reorder_threshold, null, 'explicit null must still clear it');
});

test('POST /sessions rejects malformed dates', async () => {
  const cookie = await login();
  for (const body of [
    { start_date: '2099-01-05', target_date: 'not-a-date' },
    { start_date: '01/05/2099', target_date: '2099-03-01' },
    { start_date: '2099-01-05' }, // target_date missing
  ]) {
    assert.equal((await call('POST', '/sessions', { cookie, body })).status, 400, JSON.stringify(body));
  }
});

test('POST /sessions accepts the client form body with no template picked', async () => {
  const cookie = await login();
  const body = { start_date: '2099-01-05', target_date: '2099-03-01', notes: '', template_id: '' };
  assert.equal((await call('POST', '/sessions', { cookie, body })).status, 201);
});

test('POST /sessions/:sessionId/regimens rejects a missing supplement_id', async () => {
  const cookie = await login();
  const sess = (await call('POST', '/sessions', { cookie, body: { start_date: '2099-01-05', target_date: '2099-03-01' } })).json;
  assert.equal((await call('POST', `/sessions/${sess.id}/regimens`, { cookie, body: {} })).status, 400);
  assert.equal((await call('POST', `/sessions/${sess.id}/regimens`, { cookie, body: { supplement_id: '' } })).status, 400);
});

test('POST /dose-log rejects a status outside taken/skipped', async () => {
  const cookie = await login();
  const supp = (await call('POST', '/supplements', { cookie, body: validSupplement })).json;
  const sess = (await call('POST', '/sessions', { cookie, body: { start_date: '2099-01-05', target_date: '2099-03-01' } })).json;
  const reg = (await call('POST', `/sessions/${sess.id}/regimens`, { cookie, body: { supplement_id: supp.id } })).json;
  const res = await call('POST', '/dose-log', { cookie, body: { regimen_id: reg.id, date: '2099-01-05', status: 'maybe' } });
  assert.equal(res.status, 400);
});

test('PATCH /regimens/:id still supports partial updates (validation does not force notes to be sent)', async () => {
  const cookie = await login();
  const supp = (await call('POST', '/supplements', { cookie, body: validSupplement })).json;
  const sess = (await call('POST', '/sessions', { cookie, body: { start_date: '2099-01-05', target_date: '2099-03-01' } })).json;
  const reg = (await call('POST', `/sessions/${sess.id}/regimens`, { cookie, body: { supplement_id: supp.id } })).json;
  await call('PATCH', `/regimens/${reg.id}`, { cookie, body: { notes: 'take with food' } });
  const r = await call('PATCH', `/regimens/${reg.id}`, { cookie, body: { as_needed: true } }); // notes omitted entirely
  assert.equal(r.status, 200);
  assert.equal(r.json.notes, 'take with food', 'omitting notes must not wipe it');
  assert.equal(r.json.as_needed, true);
});

test('PUT /settings/prefs rejects a non-object body but accepts an oversized-looking-but-fine one', async () => {
  const cookie = await login();
  assert.equal((await call('PUT', '/settings/prefs', { cookie, body: 'not an object' })).status, 400);
  assert.equal((await call('PUT', '/settings/prefs', { cookie, body: ['array', 'not', 'object'] })).status, 400);
  assert.equal((await call('PUT', '/settings/prefs', { cookie, body: { timezone: 'America/Chicago' } })).status, 200);
});
