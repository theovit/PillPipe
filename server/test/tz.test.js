// Pure unit tests for the timezone helpers: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { nowInTz, resolveTimezone, isValidTimezone } = require('../tz');

test('nowInTz gives the wall clock in the requested zone', () => {
  const instant = new Date('2026-09-19T03:30:00Z'); // still Sept 18 evening in the Americas
  assert.deepEqual(nowInTz('UTC', instant), { date: '2026-09-19', hhmm: '03:30', dow: 6, timezone: 'UTC' });
  assert.deepEqual(nowInTz('America/Chicago', instant), { date: '2026-09-18', hhmm: '22:30', dow: 5, timezone: 'America/Chicago' });
  assert.deepEqual(nowInTz('Asia/Kolkata', instant), { date: '2026-09-19', hhmm: '09:00', dow: 6, timezone: 'Asia/Kolkata' });
});

test('midnight is 00:xx, never 24:xx', () => {
  const r = nowInTz('America/Chicago', new Date('2026-09-19T05:05:00Z'));
  assert.equal(r.hhmm, '00:05');
  assert.equal(r.date, '2026-09-19');
});

test('DST: the same UTC hour maps to different local hours across a change', () => {
  assert.equal(nowInTz('America/Chicago', new Date('2026-03-08T07:30:00Z')).hhmm, '01:30'); // before spring-forward (CST)
  assert.equal(nowInTz('America/Chicago', new Date('2026-03-08T08:30:00Z')).hhmm, '03:30'); // 02:xx skipped (CDT)
  assert.equal(nowInTz('America/Chicago', new Date('2026-11-01T06:30:00Z')).hhmm, '01:30'); // first 01:30 (CDT)
  assert.equal(nowInTz('America/Chicago', new Date('2026-11-01T07:30:00Z')).hhmm, '01:30'); // repeated 01:30 (CST)
});

test('invalid or missing zones fall back to the process TZ, then UTC', () => {
  assert.equal(isValidTimezone('America/Chicago'), true);
  assert.equal(isValidTimezone('Mars/Olympus'), false);
  assert.equal(isValidTimezone(''), false);
  assert.equal(isValidTimezone(null), false);
  const saved = process.env.TZ;
  try {
    delete process.env.TZ;
    assert.equal(resolveTimezone('Mars/Olympus'), 'UTC');
    assert.equal(resolveTimezone(undefined), 'UTC');
    process.env.TZ = 'Europe/Paris';
    assert.equal(resolveTimezone('Mars/Olympus'), 'Europe/Paris');
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
});
