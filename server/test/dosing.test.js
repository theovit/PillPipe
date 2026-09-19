// Pure unit tests (no database, no stack): npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dailyDose, supplementDaysRemaining, activePhase, isDosingDay, dayOfWeek, dayIndex, validatePhaseBody,
} = require('../dosing');

test('dailyDose sums the meal slots and custom slots (pg NUMERIC strings included)', () => {
  assert.equal(dailyDose({ dose_morning: '1', dose_lunch: '0', dose_dinner: '2', custom_slots: [] }), 3);
  assert.equal(dailyDose({ dose_morning: 1, dose_lunch: 1, dose_dinner: 1, custom_slots: [{ amount: 1.5, time: '14:30' }, { amount: 0.5, time: '22:00' }] }), 5);
  assert.equal(dailyDose({ dose_morning: 0, dose_lunch: 0, dose_dinner: 0, custom_slots: '[{"amount":2,"time":"09:00"}]' }), 2, 'JSON string slots');
});

test('dailyDose ignores malformed slots instead of throwing', () => {
  assert.equal(dailyDose({ dose_morning: 1, dose_lunch: 0, dose_dinner: 0, custom_slots: '{not json' }), 1);
  assert.equal(dailyDose({ dose_morning: 1, dose_lunch: 0, dose_dinner: 0, custom_slots: 'null' }), 1);
  assert.equal(dailyDose({ dose_morning: 1, dose_lunch: 0, dose_dinner: 0, custom_slots: [null, 5, { amount: 'x' }] }), 1);
});

test('dailyDose rounds away float noise (0.1 + 0.2)', () => {
  assert.equal(dailyDose({ dose_morning: 0.1, dose_lunch: 0.2, dose_dinner: 0, custom_slots: [] }), 0.3);
});

test('dailyDose falls back to the legacy flat dosage for old-shaped rows', () => {
  assert.equal(dailyDose({ dosage: '2.5' }), 2.5);
  assert.equal(dailyDose({ dosage: 0, dose_morning: 3, dose_lunch: 0, dose_dinner: 0, custom_slots: [] }), 3);
});

test('date helpers work on YYYY-MM-DD strings independent of the machine timezone', () => {
  assert.equal(dayOfWeek('2026-09-21'), 1); // Monday
  assert.equal(dayOfWeek('2026-09-20'), 0); // Sunday
  assert.equal(dayIndex('2026-03-08', '2026-03-09'), 1); // across a US DST change
  assert.equal(dayIndex('2026-10-31', '2026-11-02'), 2);
  assert.equal(isDosingDay({ days_of_week: [1, 3, 5] }, '2026-09-21'), true);
  assert.equal(isDosingDay({ days_of_week: [1, 3, 5] }, '2026-09-22'), false);
  assert.equal(isDosingDay({ days_of_week: [] }, '2026-09-22'), true);
  assert.equal(isDosingDay({ days_of_week: null }, '2026-09-22'), true);
});

test('activePhase walks phases in sequence_order over a half-open session window', () => {
  const phases = [
    { id: 'b', sequence_order: 2, duration_days: 10, indefinite: false },
    { id: 'a', sequence_order: 1, duration_days: 5, indefinite: false },
  ];
  const at = today => activePhase(phases, '2026-09-01', today, 15);
  assert.equal(at('2026-08-31'), null, 'before start');
  assert.equal(at('2026-09-01').phase.id, 'a');
  assert.equal(at('2026-09-05').phase.id, 'a');
  assert.equal(at('2026-09-06').phase.id, 'b');
  assert.equal(at('2026-09-06').dayInPhase, 0);
  assert.equal(at('2026-09-15').phase.id, 'b', 'last day of the window');
  assert.equal(at('2026-09-16'), null, 'target date itself is outside the window (handoff day belongs to the next session)');
});

test('activePhase: indefinite swallows the rest, zero-length phases are skipped, gaps return null', () => {
  const indef = [
    { id: 'a', sequence_order: 1, duration_days: 3, indefinite: false },
    { id: 'z', sequence_order: 2, duration_days: 0, indefinite: false },
    { id: 'i', sequence_order: 3, duration_days: 9999, indefinite: true },
    { id: 'never', sequence_order: 4, duration_days: 5, indefinite: false },
  ];
  assert.equal(activePhase(indef, '2026-09-01', '2026-09-03', 30).phase.id, 'a');
  assert.equal(activePhase(indef, '2026-09-01', '2026-09-04', 30).phase.id, 'i');
  assert.equal(activePhase(indef, '2026-09-01', '2026-09-30', 30).phase.id, 'i');
  const short = [{ id: 'a', sequence_order: 1, duration_days: 3, indefinite: false }];
  assert.equal(activePhase(short, '2026-09-01', '2026-09-10', 30), null, 'phases end before the session does');
  assert.equal(activePhase([], '2026-09-01', '2026-09-02', 30), null);
});

test('supplementDaysRemaining averages days-of-week and sums regimens; null when nothing is scheduled', () => {
  const daily = { dose_morning: 2, dose_lunch: 0, dose_dinner: 0, custom_slots: [], days_of_week: null };
  assert.equal(supplementDaysRemaining(20, [daily]), 10);
  const mwf = { ...daily, days_of_week: [1, 3, 5] }; // 2 * 3/7 per day on average
  assert.equal(supplementDaysRemaining(6, [mwf]), 7);
  assert.equal(supplementDaysRemaining(20, [daily, daily]), 5, 'two regimens share one bottle');
  assert.equal(supplementDaysRemaining(20, []), null);
  assert.equal(supplementDaysRemaining(20, [{ ...daily, dose_morning: 0 }]), null);
  assert.equal(supplementDaysRemaining('20', [daily]), 10, 'NUMERIC string inventory');
});

test('validatePhaseBody accepts a normal body and normalises it', () => {
  const r = validatePhaseBody({
    dose_morning: '1', dose_lunch: 0, dose_dinner: 2,
    custom_slots: [{ amount: 1, time: '22:30' }, { amount: 0.5, time: '14:00' }],
    duration_days: '30', days_of_week: [5, 1, 1, 3],
  });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.value, {
    dose_morning: 1, dose_lunch: 0, dose_dinner: 2,
    custom_slots: [{ amount: 0.5, time: '14:00' }, { amount: 1, time: '22:30' }],
    duration_days: 30, days_of_week: [1, 3, 5], indefinite: false,
  });
});

test('validatePhaseBody: indefinite stores 9999, all/none weekdays mean every day, amounts round to 3 dp', () => {
  const a = validatePhaseBody({ dose_morning: 1.23456, indefinite: true, days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(a.ok, true);
  assert.equal(a.value.duration_days, 9999);
  assert.equal(a.value.indefinite, true);
  assert.equal(a.value.days_of_week, null);
  assert.equal(a.value.dose_morning, 1.235);
  assert.equal(validatePhaseBody({ dose_morning: 1, duration_days: 5, days_of_week: [] }).value.days_of_week, null);
});

test('validatePhaseBody maps a legacy {dosage} body to dose_morning', () => {
  const r = validatePhaseBody({ dosage: 2, duration_days: 7, days_of_week: null, sequence_order: 3, indefinite: false });
  assert.equal(r.ok, true);
  assert.equal(r.value.dose_morning, 2);
  assert.equal(r.value.dose_lunch, 0);
  assert.equal(validatePhaseBody({ dosage: 0, duration_days: 7 }).ok, false, 'legacy zero dose is still rejected');
});

test('validatePhaseBody rejects bad input', () => {
  const ok = { dose_morning: 1, duration_days: 5 };
  const bad = [
    [{}, 'empty body'],
    [null, 'null body'],
    [{ ...ok, dose_morning: 0 }, 'total zero'],
    [{ ...ok, dose_morning: -1, dose_lunch: 5 }, 'negative amount'],
    [{ ...ok, dose_lunch: 'abc' }, 'NaN amount'],
    [{ ...ok, dose_lunch: 1e9 }, 'absurd amount'],
    [{ ...ok, custom_slots: 'nope' }, 'slots not a list'],
    [{ ...ok, custom_slots: Array.from({ length: 13 }, () => ({ amount: 1, time: '10:00' })) }, 'too many slots'],
    [{ ...ok, custom_slots: [{ amount: 1, time: '25:00' }] }, 'bad hour'],
    [{ ...ok, custom_slots: [{ amount: 1, time: '9:00' }] }, 'not zero-padded'],
    [{ ...ok, custom_slots: [{ amount: 0, time: '10:00' }] }, 'zero slot amount'],
    [{ ...ok, custom_slots: [{ amount: 1 }] }, 'slot without time'],
    [{ ...ok, duration_days: 0 }, 'zero duration'],
    [{ ...ok, duration_days: 1.5 }, 'fractional duration'],
    [{ ...ok, duration_days: undefined }, 'missing duration'],
    [{ ...ok, duration_days: 99999 }, 'absurd duration'],
    [{ ...ok, days_of_week: [7] }, 'weekday out of range'],
    [{ ...ok, days_of_week: 'mon' }, 'weekdays not a list'],
  ];
  for (const [body, label] of bad) {
    const r = validatePhaseBody(body);
    assert.equal(r.ok, false, `${label} should be rejected`);
    assert.equal(typeof r.error, 'string');
  }
});

test('a custom-only phase is valid', () => {
  assert.equal(validatePhaseBody({ custom_slots: [{ amount: 1, time: '15:00' }], duration_days: 3 }).ok, true);
});
