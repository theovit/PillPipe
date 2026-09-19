// client/src/utils/dosing.js is a JS twin of server/dosing.js (the client has no test runner).
// This runs the same golden vectors through both so the two implementations cannot drift apart.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const server = require('../dosing');

const loadClient = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'client', 'src', 'utils', 'dosing.js')).href);

const PHASES = [
  { dose_morning: 1, dose_lunch: 0, dose_dinner: 2, custom_slots: [] },
  { dose_morning: '0.1', dose_lunch: '0.2', dose_dinner: '0', custom_slots: [{ amount: 0.5, time: '14:00' }] },
  { dose_morning: 0, dose_lunch: 0, dose_dinner: 0, custom_slots: '[{"amount":2,"time":"09:00"},{"amount":1.5,"time":"21:00"}]' },
  { dose_morning: 1, custom_slots: '{not json' },
  { dose_morning: null, dose_lunch: null, dose_dinner: null, custom_slots: null },
  { dosage: '2.5' },
  { dose_morning: 0.1, dose_lunch: 0.1, dose_dinner: 0.1, custom_slots: [{ amount: 0.1, time: '10:00' }] },
];

test('dailyDose agrees on every vector', async () => {
  const client = await loadClient();
  for (const p of PHASES) {
    assert.equal(client.dailyDose(p), server.dailyDose(p), JSON.stringify(p));
  }
});

test('activePhase agrees over a grid of dates', async () => {
  const client = await loadClient();
  const sets = [
    [{ id: 'a', sequence_order: 1, duration_days: 5, indefinite: false }, { id: 'b', sequence_order: 2, duration_days: 10, indefinite: false }],
    [{ id: 'a', sequence_order: 1, duration_days: 3, indefinite: false }, { id: 'z', sequence_order: 2, duration_days: 0, indefinite: false }, { id: 'i', sequence_order: 3, duration_days: 9999, indefinite: true }],
    [{ id: 'x', sequence_order: 2, duration_days: 4, indefinite: false }, { id: 'y', sequence_order: 1, duration_days: 2, indefinite: false }],
    [],
  ];
  for (const phases of sets) {
    for (const totalDays of [1, 7, 20]) {
      for (let offset = -3; offset < 25; offset++) {
        const today = new Date(Date.UTC(2026, 8, 1 + offset)).toISOString().slice(0, 10);
        const s = server.activePhase(phases, '2026-09-01', today, totalDays);
        const c = client.activePhase(phases, '2026-09-01', today, totalDays);
        assert.deepEqual(c && { id: c.phase.id, index: c.index, day: c.dayInPhase }, s && { id: s.phase.id, index: s.index, day: s.dayInPhase },
          `${JSON.stringify(phases.map(p => p.id))} total=${totalDays} today=${today}`);
      }
    }
  }
});

test('the time pattern and rounding helpers match', async () => {
  const client = await loadClient();
  assert.equal(client.TIME_RE.source, server.TIME_RE.source);
  assert.equal(client.MAX_CUSTOM_SLOTS, server.MAX_CUSTOM_SLOTS);
  for (const n of [0.1 + 0.2, 1.23456, 2, 1e-9, 100.0004999]) {
    assert.equal(client.round3(n), server.round3(n));
    assert.equal(client.round6(n), server.round6(n));
  }
});

test('client formatting: notation, totals and 12-hour times', async () => {
  const c = await loadClient();
  assert.equal(c.phaseNotation({ dose_morning: '1', dose_lunch: '1', dose_dinner: '2', custom_slots: [] }), 'B1 L1 D2');
  assert.equal(c.phaseNotation({ dose_morning: 0, dose_lunch: 0, dose_dinner: 0.5, custom_slots: [{ amount: 1, time: '14:30' }, { amount: 2, time: '07:05' }] }),
    'D0.5 +2@7:05 AM +1@2:30 PM');
  assert.equal(c.phaseNotation({ dose_morning: 0, dose_lunch: 0, dose_dinner: 0, custom_slots: [] }), '—');
  assert.equal(c.totalLabel({ dose_morning: 0.1, dose_lunch: 0.2, dose_dinner: 0, custom_slots: [] }, 'tablets'), '0.3 tabs/day');
  assert.equal(c.totalLabel({ dose_morning: 2, dose_lunch: 0, dose_dinner: 0, custom_slots: [] }, 'ml'), '2 ml/day');
  assert.equal(c.formatTime12('00:05'), '12:05 AM');
  assert.equal(c.formatTime12('12:00'), '12:00 PM');
  assert.equal(c.formatTime12('23:59'), '11:59 PM');
  assert.equal(c.formatAmount(0.30000000000000004), '0.3');
  assert.deepEqual(c.resolveMealTimes({ morningTime: '7:30', lunchTime: '13:15' }), { morningTime: '08:00', lunchTime: '13:15', dinnerTime: '18:00' },
    'malformed times fall back to the defaults');
});

test('todayInTz gives a YYYY-MM-DD date and survives a bad zone', async () => {
  const c = await loadClient();
  assert.match(c.todayInTz('America/Chicago'), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(c.todayInTz('Mars/Olympus'), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(c.todayInTz(null), /^\d{4}-\d{2}-\d{2}$/);
});

test('server and client agree on the meal-time defaults', async () => {
  const client = await loadClient();
  const { MEAL_DEFAULTS } = require('../notifications');
  assert.deepEqual(client.MEAL_DEFAULTS, MEAL_DEFAULTS);
  assert.deepEqual(client.SLOTS.map(s => s.prefKey), ['morningTime', 'lunchTime', 'dinnerTime']);
});
