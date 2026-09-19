// Black-box API tests for meal-time dosing data flows. Like auth.test.js these are destructive
// (restore wipes the database) — run ONLY against the throwaway stack in docker-compose.test.yml.
//
//   TEST_PASSWORD=correct-horse-battery npm test      (files run one at a time)
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:13000';
const PASSWORD = process.env.TEST_PASSWORD;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  throw new Error(`Refusing to run destructive tests against ${BASE} (localhost only)`);
}
if (!PASSWORD) throw new Error('Set TEST_PASSWORD to the password used for TEST_APP_PASSWORD_HASH');

let ipCounter = 0;
const nextIp = () => `10.30.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

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

// The test stack's sessions live only a few seconds, so every test logs in for itself and stays quick.
async function login() {
  const res = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'pillpipe', 'X-Forwarded-For': nextIp() },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(res.status, 200, 'login');
  return res.headers.getSetCookie()[0].split(';')[0];
}

const isoDay = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function setup(cookie, { supplement = {}, session = {} } = {}) {
  const supp = (await call('POST', '/supplements', {
    cookie,
    body: { name: 'T-' + Math.random().toString(36).slice(2, 8), pills_per_bottle: 60, price: 10, type: 'maintenance', current_inventory: 20, unit: 'capsules', ...supplement },
  })).json;
  const sess = (await call('POST', '/sessions', {
    cookie, body: { start_date: '2099-01-05', target_date: '2099-03-01', ...session },
  })).json;
  return { supp, sess };
}

async function addRegimen(cookie, sess, supp) {
  return (await call('POST', `/sessions/${sess.id}/regimens`, { cookie, body: { supplement_id: supp.id } })).json;
}

const addPhase = async (cookie, reg, body) => {
  const r = await call('POST', `/regimens/${reg.id}/phases`, { cookie, body });
  assert.equal(r.status, 201, r.text);
  return r.json;
};

const shape = p => ({
  dose_morning: Number(p.dose_morning), dose_lunch: Number(p.dose_lunch), dose_dinner: Number(p.dose_dinner),
  custom_slots: p.custom_slots, duration_days: p.duration_days, days_of_week: p.days_of_week,
  indefinite: p.indefinite, sequence_order: p.sequence_order,
});

const PHASE_A = { dose_morning: 1, dose_dinner: 2.5, custom_slots: [{ amount: 0.5, time: '14:00' }, { amount: 1, time: '22:30' }], duration_days: 10, days_of_week: [1, 3, 5] };
const PHASE_B = { dose_lunch: 1, indefinite: true };

test('phases: create, edit, validation and server-assigned order', async () => {
  const cookie = await login();
  const { supp, sess } = await setup(cookie);
  const reg = await addRegimen(cookie, sess, supp);

  const a = await addPhase(cookie, reg, PHASE_A);
  assert.deepEqual(shape(a), { dose_morning: 1, dose_lunch: 0, dose_dinner: 2.5, custom_slots: PHASE_A.custom_slots, duration_days: 10, days_of_week: [1, 3, 5], indefinite: false, sequence_order: 1 });

  const legacy = await addPhase(cookie, reg, { dosage: 2, duration_days: 5, sequence_order: 99 });
  assert.equal(Number(legacy.dose_morning), 2, 'legacy {dosage} body maps to breakfast');
  assert.equal(legacy.sequence_order, 2, 'client-sent sequence_order is ignored');

  const third = await addPhase(cookie, reg, { dose_lunch: 1, duration_days: 3 });
  assert.equal((await call('DELETE', `/phases/${legacy.id}`, { cookie })).status, 204);
  const fourth = await addPhase(cookie, reg, { dose_dinner: 1, duration_days: 3 });
  assert.equal(fourth.sequence_order, third.sequence_order + 1, 'adding after a middle delete does not collide');

  for (const body of [{}, { dose_morning: 0, duration_days: 5 }, { dose_morning: -1, dose_lunch: 3, duration_days: 5 },
    { dose_morning: 1, duration_days: 0 }, { dose_morning: 1, duration_days: 5, custom_slots: [{ amount: 1, time: '25:00' }] }]) {
    assert.equal((await call('POST', `/regimens/${reg.id}/phases`, { cookie, body })).status, 400, JSON.stringify(body));
  }

  const put = await call('PUT', `/phases/${a.id}`, { cookie, body: { dose_morning: 3, duration_days: 7, sequence_order: 42 } });
  assert.equal(put.status, 200, put.text);
  assert.equal(Number(put.json.dose_morning), 3);
  assert.equal(put.json.sequence_order, 1, 'PUT keeps the existing order');
  assert.deepEqual(put.json.custom_slots, []);
  assert.equal((await call('PUT', `/phases/${a.id}`, { cookie, body: { duration_days: 7 } })).status, 400);
});

test('take_with_food is stored, returned, and preserved by edits that omit it', async () => {
  const cookie = await login();
  const { supp } = await setup(cookie, { supplement: { take_with_food: true } });
  assert.equal(supp.take_with_food, true);
  const edit = { name: supp.name, pills_per_bottle: 60, price: 10, type: 'maintenance', current_inventory: 20, unit: 'capsules' };
  assert.equal((await call('PUT', `/supplements/${supp.id}`, { cookie, body: edit })).json.take_with_food, true, 'omitted -> unchanged');
  assert.equal((await call('PUT', `/supplements/${supp.id}`, { cookie, body: { ...edit, take_with_food: false } })).json.take_with_food, false);
  const list = (await call('GET', '/supplements', { cookie })).json;
  assert.equal(list.find(s => s.id === supp.id).take_with_food, false);
  const sess = (await call('POST', '/sessions', { cookie, body: { start_date: '2099-01-05', target_date: '2099-03-01' } })).json;
  const reg = await addRegimen(cookie, sess, supp);
  const regs = (await call('GET', `/sessions/${sess.id}/regimens`, { cookie })).json;
  assert.equal(regs.find(r => r.id === reg.id).take_with_food, false, 'regimen rows carry the supplement flag');
});

test('regimen PATCH is partial: notes and as_needed do not clobber each other', async () => {
  const cookie = await login();
  const { supp, sess } = await setup(cookie);
  const reg = await addRegimen(cookie, sess, supp);
  assert.equal(reg.as_needed, false);
  const withNotes = await call('PATCH', `/regimens/${reg.id}`, { cookie, body: { notes: 'with breakfast' } });
  assert.equal(withNotes.json.notes, 'with breakfast');
  const asNeeded = await call('PATCH', `/regimens/${reg.id}`, { cookie, body: { as_needed: true } });
  assert.equal(asNeeded.json.as_needed, true);
  assert.equal(asNeeded.json.notes, 'with breakfast', 'as_needed alone must not wipe notes');
  const cleared = await call('PATCH', `/regimens/${reg.id}`, { cookie, body: { notes: '' } });
  assert.equal(cleared.json.notes, null);
  assert.equal(cleared.json.as_needed, true, 'notes alone must not reset as_needed');
  assert.equal((await call('PATCH', `/regimens/${'00000000-0000-0000-0000-000000000000'}`, { cookie, body: { notes: 'x' } })).status, 404);
});

test('/calculate covers scheduled regimens and skips as-needed ones', async () => {
  const cookie = await login();
  const { supp, sess } = await setup(cookie, { supplement: { current_inventory: 1000 } });
  const scheduled = await addRegimen(cookie, sess, supp);
  await addPhase(cookie, scheduled, { dose_morning: 1, dose_dinner: 1, duration_days: 10 });
  const prn = await addRegimen(cookie, sess, supp);
  await call('PATCH', `/regimens/${prn.id}`, { cookie, body: { as_needed: true } });
  const calc = (await call('GET', `/sessions/${sess.id}/calculate`, { cookie })).json;
  assert.deepEqual(calc.results.map(r => r.regimen_id), [scheduled.id]);
  assert.equal(calc.results[0].pillsNeeded, 20);
});

test('days_remaining follows the ACTIVE phase, sums regimens, and ignores as-needed and inactive sessions', async () => {
  const cookie = await login();
  const dates = { start_date: isoDay(-1), target_date: isoDay(30) };
  const { supp, sess } = await setup(cookie, { supplement: { current_inventory: 20 }, session: dates });
  const reg = await addRegimen(cookie, sess, supp);
  await addPhase(cookie, reg, { dose_morning: 1, duration_days: 3 }); // active: yesterday..+1
  await addPhase(cookie, reg, { dose_morning: 4, dose_dinner: 1, duration_days: 20 }); // later: 5/day
  const days = async () => (await call('GET', '/supplements', { cookie })).json.find(s => s.id === supp.id).days_remaining;
  assert.equal(await days(), 20, 'first phase (1/day) is active, not the later one');

  const second = await addRegimen(cookie, sess, supp);
  await addPhase(cookie, second, { dose_morning: 1, duration_days: 10 });
  assert.equal(await days(), 10, 'two regimens share the bottle (1/day + 1/day)');

  await call('PATCH', `/regimens/${second.id}`, { cookie, body: { as_needed: true } });
  assert.equal(await days(), 20, 'as-needed regimens are excluded');

  const future = await setup(cookie, { supplement: { current_inventory: 20 }, session: { start_date: isoDay(10), target_date: isoDay(40) } });
  const futureReg = await addRegimen(cookie, future.sess, future.supp);
  await addPhase(cookie, futureReg, { dose_morning: 1, duration_days: 10 });
  const futureDays = (await call('GET', '/supplements', { cookie })).json.find(s => s.id === future.supp.id).days_remaining;
  assert.equal(futureDays, null, 'a session that has not started schedules nothing today');
});

async function buildSchedule(cookie) {
  const { supp, sess } = await setup(cookie, { supplement: { take_with_food: true } });
  const reg = await addRegimen(cookie, sess, supp);
  await addPhase(cookie, reg, PHASE_A);
  await addPhase(cookie, reg, PHASE_B);
  const prn = await addRegimen(cookie, sess, supp);
  await call('PATCH', `/regimens/${prn.id}`, { cookie, body: { as_needed: true } });
  return { supp, sess, reg, prn };
}

const phasesOf = async (cookie, reg) => (await call('GET', `/regimens/${reg.id}/phases`, { cookie })).json.map(shape);

test('copy session and templates carry every dosing field, including indefinite and as_needed', async () => {
  const cookie = await login();
  const { sess, reg } = await buildSchedule(cookie);
  const original = await phasesOf(cookie, reg);
  assert.equal(original.length, 2);
  assert.equal(original[1].indefinite, true);

  const copy = (await call('POST', `/sessions/${sess.id}/copy`, { cookie, body: { start_date: '2099-04-01', target_date: '2099-06-01' } })).json;
  const copiedRegs = (await call('GET', `/sessions/${copy.id}/regimens`, { cookie })).json;
  assert.equal(copiedRegs.length, 2);
  assert.deepEqual(copiedRegs.map(r => r.as_needed).sort(), [false, true]);
  const copiedScheduled = copiedRegs.find(r => !r.as_needed);
  assert.deepEqual(await phasesOf(cookie, copiedScheduled), original, 'copy keeps doses, slots, days and the indefinite flag');

  const tmpl = (await call('POST', `/sessions/${sess.id}/save-as-template`, { cookie, body: { name: 'T ' + Date.now() } })).json;
  const fromTmpl = (await call('POST', '/sessions', { cookie, body: { start_date: '2099-07-01', target_date: '2099-09-01', template_id: tmpl.id } })).json;
  const tmplRegs = (await call('GET', `/sessions/${fromTmpl.id}/regimens`, { cookie })).json;
  assert.deepEqual(tmplRegs.map(r => r.as_needed).sort(), [false, true]);
  assert.deepEqual(await phasesOf(cookie, tmplRegs.find(r => !r.as_needed)), original, 'template round trip is lossless');
});

test('backup v2 round-trips every dosing field through restore', async () => {
  const cookie = await login();
  const { supp, reg, prn } = await buildSchedule(cookie);
  const before = await phasesOf(cookie, reg);
  const backup = (await call('GET', '/backup', { cookie })).json;
  assert.equal(backup.version, 2);
  assert.ok(backup.phases.every(p => p.dose_morning !== undefined && Array.isArray(p.custom_slots)));
  assert.ok(backup.supplements.find(s => s.id === supp.id).take_with_food);

  const res = await call('POST', '/restore', { cookie, body: backup });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(await phasesOf(cookie, reg), before);
  const restored = (await call('GET', '/supplements', { cookie })).json.find(s => s.id === supp.id);
  assert.equal(restored.take_with_food, true);
  const regs = (await call('GET', `/sessions/${backup.regimens.find(r => r.id === prn.id).session_id}/regimens`, { cookie })).json;
  assert.equal(regs.find(r => r.id === prn.id).as_needed, true);
  assert.ok((await call('GET', '/templates', { cookie })).json.length >= 0);
});

test('a version-1 (flat dosage) backup restores into dose_morning; unknown versions are refused untouched', async () => {
  const cookie = await login();
  const { reg } = await buildSchedule(cookie);
  const backup = (await call('GET', '/backup', { cookie })).json;
  const v1 = {
    ...backup, version: 1,
    phases: backup.phases.map(p => ({ id: p.id, regimen_id: p.regimen_id, dosage: '3', duration_days: p.duration_days, days_of_week: p.days_of_week, indefinite: p.indefinite, sequence_order: p.sequence_order })),
    template_phases: [],
  };
  const res = await call('POST', '/restore', { cookie, body: v1 });
  assert.equal(res.status, 200, res.text);
  const migrated = await phasesOf(cookie, reg);
  assert.ok(migrated.length > 0);
  assert.ok(migrated.every(p => p.dose_morning === 3 && p.dose_lunch === 0 && p.dose_dinner === 0 && p.custom_slots.length === 0));

  const counts = async () => (await call('GET', '/supplements', { cookie })).json.length;
  const n = await counts();
  for (const bad of [{ ...backup, version: 3 }, { ...backup, version: 0 }, { version: 2 }]) {
    assert.equal((await call('POST', '/restore', { cookie, body: bad })).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(await counts(), n, 'refused restores must not delete anything');

  const noVersion = { ...v1 };
  delete noVersion.version;
  assert.equal((await call('POST', '/restore', { cookie, body: noVersion })).status, 200, 'files without a version still restore');
});

test('the old per-regimen reminder route is gone and the test push works without subscriptions', async () => {
  const cookie = await login();
  const { supp, sess } = await setup(cookie);
  const reg = await addRegimen(cookie, sess, supp);
  assert.equal((await call('PATCH', `/regimens/${reg.id}/reminder`, { cookie, body: { reminder_time: '08:00' } })).status, 404);
  const regs = (await call('GET', `/sessions/${sess.id}/regimens`, { cookie })).json;
  assert.ok(regs.find(r => r.id === reg.id), 'regimens still load');
  const push = await call('POST', '/push/test', { cookie, body: {} });
  assert.equal(push.status, 404, 'no subscriptions -> a clean 404, not a crash');
});
