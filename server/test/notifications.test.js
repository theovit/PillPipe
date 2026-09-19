// Pure unit tests for batched dose reminders (injected clock, no database, no web-push): npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MEAL_DEFAULTS, PAYLOAD_LIMIT, normalizeSchedulePrefs, dueNotifications, buildPayload, sendBatch, createDeduper, formatTime12,
} = require('../notifications');
const { nowInTz } = require('../tz');

const phase = (over = {}) => ({
  sequence_order: 1, duration_days: 30, indefinite: false, days_of_week: null,
  dose_morning: 0, dose_lunch: 0, dose_dinner: 0, custom_slots: [], ...over,
});
const reg = (id, name, phases, over = {}) => ({
  id, as_needed: false, supplement_name: name, unit: 'capsules', take_with_food: false,
  start_date: '2026-09-01', target_date: '2026-10-01', phases, ...over,
});
const at = (date, hhmm) => ({ date, hhmm });
const prefs = { ...MEAL_DEFAULTS, timezone: 'UTC' };
const due = (regimens, now, p = prefs) => dueNotifications({ now, prefs: p, regimens });

test('a breakfast dose is due at the breakfast time and only then', () => {
  const rs = [reg('r1', 'Magnesium', [phase({ dose_morning: 2 })])];
  const batch = due(rs, at('2026-09-15', '08:00'));
  assert.equal(batch.time, '08:00');
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0].amount, 2);
  assert.equal(due(rs, at('2026-09-15', '08:01')), null);
  assert.equal(due(rs, at('2026-09-15', '07:59')), null);
  assert.equal(due(rs, at('2026-09-15', '12:00')), null, 'no lunch dose');
});

test('meal times come from the prefs, malformed prefs fall back to defaults', () => {
  const rs = [reg('r1', 'D3', [phase({ dose_morning: 1, dose_dinner: 1 })])];
  const custom = { ...prefs, morningTime: '07:30', dinnerTime: '19:15' };
  assert.equal(due(rs, at('2026-09-15', '07:30'), custom).items.length, 1);
  assert.equal(due(rs, at('2026-09-15', '19:15'), custom).items.length, 1);
  assert.equal(due(rs, at('2026-09-15', '08:00'), custom), null);
  const broken = { morningTime: '7:30', dinnerTime: 'noon', timezone: 'Mars/Olympus' };
  assert.equal(due(rs, at('2026-09-15', '08:00'), broken).items.length, 1, 'bad morningTime -> 08:00');
  assert.equal(due(rs, at('2026-09-15', '18:00'), broken).items.length, 1, 'bad dinnerTime -> 18:00');
  assert.deepEqual(normalizeSchedulePrefs(null), { ...MEAL_DEFAULTS, timezone: null });
  assert.equal(normalizeSchedulePrefs({ timezone: 'America/Chicago' }).timezone, 'America/Chicago');
});

test('everything due at one minute is batched into one notification, sorted by name', () => {
  const rs = [
    reg('r3', 'Zinc', [phase({ dose_morning: 1 })]),
    reg('r1', 'Ashwagandha', [phase({ dose_morning: 2 })], { unit: 'tablets' }),
    reg('r2', 'Fish oil', [phase({ dose_morning: 1 })], { take_with_food: true }),
    reg('r4', 'Melatonin', [phase({ dose_dinner: 1 })]),
  ];
  const batch = due(rs, at('2026-09-15', '08:00'));
  assert.deepEqual(batch.items.map(i => i.supplement), ['Ashwagandha', 'Fish oil', 'Zinc']);
  const p = JSON.parse(buildPayload(batch));
  assert.equal(p.title, '8:00 AM — 3 supplements due');
  assert.equal(p.body, '• 2 tabs Ashwagandha\n• 1 caps Fish oil (with food)\n• 1 caps Zinc');
  assert.equal(p.tag, 'dose-batch-2026-09-15-0800');
  assert.equal(p.data.kind, 'dose');
  assert.equal(p.data.date, '2026-09-15');
});

test('a single supplement gets a direct title', () => {
  const batch = due([reg('r1', 'Magnesium', [phase({ dose_morning: 0.5 })], { unit: 'ml' })], at('2026-09-15', '08:00'));
  const p = JSON.parse(buildPayload(batch));
  assert.equal(p.title, 'Time to take Magnesium');
  assert.equal(p.body, '• 0.5 ml Magnesium');
});

test('slots that land on the same minute are merged (custom time equal to a meal time)', () => {
  const rs = [reg('r1', 'A', [phase({ dose_morning: 1, custom_slots: [{ amount: 0.5, time: '08:00' }] })])];
  const batch = due(rs, at('2026-09-15', '08:00'));
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0].amount, 1.5);
  assert.equal(batch.items[0].loggable, true, 'still a single dose time today');
});

test('custom slots fire at their own time', () => {
  const rs = [reg('r1', 'A', [phase({ custom_slots: [{ amount: 1, time: '14:30' }] })])];
  assert.equal(due(rs, at('2026-09-15', '14:30')).items[0].amount, 1);
  assert.equal(due(rs, at('2026-09-15', '08:00')), null);
});

test('only single-dose-per-day regimens are loggable from a notification tap', () => {
  const rs = [
    reg('once', 'Once', [phase({ dose_morning: 1 })]),
    reg('twice', 'Twice', [phase({ dose_morning: 1, dose_dinner: 1 })]),
  ];
  const batch = due(rs, at('2026-09-15', '08:00'));
  assert.deepEqual(batch.items.map(i => [i.supplement, i.loggable]), [['Once', true], ['Twice', false]]);
  assert.deepEqual(JSON.parse(buildPayload(batch)).data.regimenIds, ['once']);
});

test('days of week: only dosing days notify', () => {
  const rs = [reg('r1', 'MWF', [phase({ dose_morning: 1, days_of_week: [1, 3, 5] })])];
  assert.equal(due(rs, at('2026-09-14', '08:00')).items.length, 1, 'Monday');
  assert.equal(due(rs, at('2026-09-15', '08:00')), null, 'Tuesday');
  assert.equal(due(rs, at('2026-09-16', '08:00')).items.length, 1, 'Wednesday');
});

test('session window is half-open: the target date belongs to the next session', () => {
  const rs = [reg('r1', 'A', [phase({ dose_morning: 1, duration_days: 9999, indefinite: true })], { start_date: '2026-09-01', target_date: '2026-09-10' })];
  assert.equal(due(rs, at('2026-08-31', '08:00')), null, 'before start');
  assert.equal(due(rs, at('2026-09-01', '08:00')).items.length, 1, 'start day');
  assert.equal(due(rs, at('2026-09-09', '08:00')).items.length, 1, 'last day');
  assert.equal(due(rs, at('2026-09-10', '08:00')), null, 'target date (handoff day)');
  assert.equal(due(rs, at('2026-09-11', '08:00')), null, 'after');
});

test('only the ACTIVE phase counts', () => {
  const rs = [reg('r1', 'A', [
    phase({ sequence_order: 1, duration_days: 5, dose_morning: 1 }),
    phase({ sequence_order: 2, duration_days: 10, dose_dinner: 2 }),
  ])];
  assert.equal(due(rs, at('2026-09-05', '08:00')).items.length, 1, 'day 5: phase 1');
  assert.equal(due(rs, at('2026-09-06', '08:00')), null, 'day 6: phase 2 has no breakfast');
  assert.equal(due(rs, at('2026-09-06', '18:00')).items[0].amount, 2, 'day 6: phase 2 dinner');
  assert.equal(due(rs, at('2026-09-20', '18:00')), null, 'phases have run out');
});

test('as-needed, phase-less and zero-dose regimens never notify', () => {
  const rs = [
    reg('prn', 'PRN', [phase({ dose_morning: 1 })], { as_needed: true }),
    reg('none', 'NoPhases', []),
    reg('zero', 'Zero', [phase()]),
  ];
  assert.equal(due(rs, at('2026-09-15', '08:00')), null);
});

test('payload stays under the size limit for a huge batch and reports what was cut', () => {
  const rs = Array.from({ length: 300 }, (_, i) => reg(`id-${String(i).padStart(3, '0')}-aaaa-bbbb-cccc-dddddddddddd`, `Supplement number ${i} with a long descriptive name`, [phase({ dose_morning: 1 })]));
  const batch = due(rs, at('2026-09-15', '08:00'));
  assert.equal(batch.items.length, 300);
  const payload = buildPayload(batch);
  assert.ok(Buffer.byteLength(payload) <= PAYLOAD_LIMIT, `payload is ${Buffer.byteLength(payload)} bytes`);
  const p = JSON.parse(payload);
  assert.match(p.body, /\+\d+ more$/);
  const shown = p.body.split('\n').filter(l => l.startsWith('•')).length;
  assert.equal(p.data.regimenIds.length, shown, 'only shown, loggable items are listed');
  assert.ok(shown >= 20, 'still shows a useful number of items');
});

test('sendBatch counts results and reports dead subscriptions (404/410) only', async () => {
  const batch = due([reg('r1', 'A', [phase({ dose_morning: 1 })])], at('2026-09-15', '08:00'));
  const subs = [{ endpoint: 'ok' }, { endpoint: 'gone-410' }, { endpoint: 'gone-404' }, { endpoint: 'boom-500' }];
  const gone = [];
  const send = async (sub) => {
    if (sub.endpoint.startsWith('gone-')) throw Object.assign(new Error('gone'), { statusCode: Number(sub.endpoint.slice(5)) });
    if (sub.endpoint === 'boom-500') throw Object.assign(new Error('server'), { statusCode: 500 });
  };
  const r = await sendBatch({ batch, subscriptions: subs, send, onGone: async s => { gone.push(s.endpoint); } });
  assert.equal(r.sent, 1);
  assert.equal(r.failed, 3);
  assert.deepEqual(gone.sort(), ['gone-404', 'gone-410']);
  assert.equal(JSON.parse(r.payload).data.kind, 'dose');
});

test('deduper: prunes other days and blocks repeats, including a repeated DST hour', () => {
  const d = createDeduper();
  d.add('2026-09-15|08:00');
  assert.equal(d.has('2026-09-15|08:00'), true);
  assert.equal(d.has('2026-09-15|08:01'), false);
  d.add('2026-09-14|23:59');
  d.prune('2026-09-15');
  assert.equal(d.has('2026-09-14|23:59'), false);
  assert.equal(d.size, 1);

  // Fall-back day in Chicago: 01:30 happens twice; both instants share one key so it notifies once.
  const first = nowInTz('America/Chicago', new Date('2026-11-01T06:30:00Z'));
  const second = nowInTz('America/Chicago', new Date('2026-11-01T07:30:00Z'));
  const k = c => `${c.date}|${c.hhmm}`;
  assert.equal(k(first), k(second));
  const dd = createDeduper();
  dd.add(k(first));
  assert.equal(dd.has(k(second)), true);
});

test('timezone decides the local minute a reminder fires', () => {
  const rs = [reg('r1', 'A', [phase({ dose_morning: 1 })])];
  const instant = new Date('2026-09-15T13:00:00Z'); // 08:00 in Chicago (CDT), 13:00 UTC
  const chicago = nowInTz('America/Chicago', instant);
  assert.equal(due(rs, chicago, { ...prefs, timezone: 'America/Chicago' }).items.length, 1);
  assert.equal(due(rs, nowInTz('UTC', instant)), null, 'the same instant is 13:00 UTC, not breakfast');
});

test('12-hour formatting', () => {
  assert.equal(formatTime12('00:00'), '12:00 AM');
  assert.equal(formatTime12('08:05'), '8:05 AM');
  assert.equal(formatTime12('12:30'), '12:30 PM');
  assert.equal(formatTime12('23:59'), '11:59 PM');
});
