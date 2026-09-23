// Pure unit tests for the shortfall engine: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../calculator');

// pg hands the engine local-midnight Date objects for DATE columns; build the same so results don't
// depend on the machine's timezone. The far-future start keeps "days elapsed" at 0.
const day = (y, m, d) => new Date(y, m - 1, d);
const START = day(2099, 1, 5); // a Monday
const phase = (over = {}) => ({
  sequence_order: 1, duration_days: 30, indefinite: false, days_of_week: null,
  dose_morning: 0, dose_lunch: 0, dose_dinner: 0, custom_slots: [], ...over,
});
const run = (phases, inventory, days = 30, extra = {}) => calculate({
  phases, inventory, startDate: START, targetDate: day(2099, 1, 5 + days), pillsPerBottle: 60, pricePerBottle: 10, ...extra,
});

test('meal + custom slots are summed into the daily dose', () => {
  const r = run([phase({ dose_morning: 1, dose_dinner: 2, custom_slots: [{ amount: 1, time: '14:00' }] })], 200);
  assert.equal(r.pillsNeeded, 4 * 30);
  assert.equal(r.status, 'covered');
  assert.equal(r.shortfall, 0);
});

test('shortfall, bottles, waste and cost', () => {
  const r = run([phase({ dose_morning: 2 })], 30); // needs 60, has 30
  assert.equal(r.status, 'shortfall');
  assert.equal(r.shortfall, 30);
  assert.equal(r.bottlesNeeded, 1);
  assert.equal(r.waste, 30);
  assert.equal(r.estimatedCost, 10);
  assert.equal(r.daysShort, 15);
});

test('days of week only count dosing days', () => {
  const r = run([phase({ dose_morning: 1, days_of_week: [1, 3, 5] })], 100, 28); // 4 weeks of Mon/Wed/Fri
  assert.equal(r.pillsNeeded, 12);
});

test('indefinite phase fills the rest of the session', () => {
  const r = run([phase({ dose_morning: 1, duration_days: 9999, indefinite: true })], 100, 20);
  assert.equal(r.pillsNeeded, 20);
});

test('phases run back to back in sequence_order', () => {
  const r = run([
    phase({ sequence_order: 2, dose_morning: 1, duration_days: 10 }),
    phase({ sequence_order: 1, dose_morning: 3, duration_days: 5 }),
  ], 500, 15);
  assert.equal(r.pillsNeeded, 5 * 3 + 10 * 1);
});

test('fractional doses do not trip coverage on float noise (0.1 x3 vs 0.3)', () => {
  const p = phase({ dose_morning: 0.1, dose_lunch: 0.1, dose_dinner: 0.1 }); // 0.3/day
  const r = run([p], 9); // exactly 30 days of supply
  assert.equal(r.pillsNeeded, 9);
  assert.equal(r.shortfall, 0);
  assert.equal(r.status, 'covered');
  assert.equal(r.daysShort, 0);
});

test('pg NUMERIC strings are coerced', () => {
  const r = run([phase({ dose_morning: '1.5', dose_lunch: '0', dose_dinner: '0.5', custom_slots: [] })], 100);
  assert.equal(r.pillsNeeded, 60);
});

test('legacy flat-dosage rows still calculate', () => {
  const r = run([{ sequence_order: 1, duration_days: 10, indefinite: false, days_of_week: null, dosage: '2' }], 100, 10);
  assert.equal(r.pillsNeeded, 20);
});

test('all-or-nothing daily coverage: a day is covered only if the whole day fits', () => {
  const r = run([phase({ dose_morning: 2, dose_dinner: 2 })], 10, 10); // 4/day, 10 on hand -> 2 days covered
  assert.equal(r.daysShort, 8);
  assert.equal(r.runOutDay, 2);
});

test('daysElapsed follows the caller-supplied `today`, not the server clock', () => {
  // Regression for calculator.js computing "today" from the server's own clock (UTC in Docker)
  // instead of the owner's timezone. A caller now passes today as 'YYYY-MM-DD' (from nowInTz);
  // it must land on the same local-midnight convention as start/target, one day apart per string.
  const p = phase({ dose_morning: 1 });
  const r0 = run([p], 100, 30, { today: '2099-01-05' }); // = START, 0 days elapsed
  assert.equal(r0.daysElapsed, 0);
  assert.equal(r0.pillsConsumedToDate, 0);

  const r5 = run([p], 100, 30, { today: '2099-01-10' }); // 5 days later
  assert.equal(r5.daysElapsed, 5);
  assert.equal(r5.pillsConsumedToDate, 5);

  const rClamped = run([p], 100, 30, { today: '2199-01-01' }); // long after target: clamps to totalDays
  assert.equal(rClamped.daysElapsed, 30);
});
