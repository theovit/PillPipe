// Batched dose reminders: one push per time slot listing every supplement due at that minute.
// Everything here is pure (no database, no web-push) so it can be unit-tested with an injected clock;
// server/index.js loads the data, calls dueNotifications(), and sends with sendBatch().
const { activePhase, dayIndex, isDosingDay, parseSlots, round3, TIME_RE } = require('./dosing');
const { isValidTimezone } = require('./tz');

// Same keys and defaults as the client prefs (a test keeps them in agreement).
const MEAL_DEFAULTS = { morningTime: '08:00', lunchTime: '12:00', dinnerTime: '18:00' };
const MEAL_SLOTS = [
  { key: 'dose_morning', prefKey: 'morningTime' },
  { key: 'dose_lunch', prefKey: 'lunchTime' },
  { key: 'dose_dinner', prefKey: 'dinnerTime' },
];
// Web Push payloads are capped near 4 KB; stay clear of it.
const PAYLOAD_LIMIT = 3600;

// PUT /settings/prefs stores arbitrary JSON, so anything read for scheduling is validated here.
function normalizeSchedulePrefs(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  const out = {};
  for (const [k, def] of Object.entries(MEAL_DEFAULTS)) out[k] = typeof p[k] === 'string' && TIME_RE.test(p[k]) ? p[k] : def;
  out.timezone = isValidTimezone(p.timezone) ? p.timezone : null;
  return out;
}

const unitShort = unit => (unit === 'ml' ? 'ml' : unit === 'drops' ? 'drops' : unit === 'tablets' ? 'tabs' : 'caps');
const formatAmount = v => String(round3(Number(v) || 0));

function formatTime12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// Every dose time of a phase for one day: [{ time: 'HH:MM', amount }], slots at the same time merged.
function slotsForPhase(phase, meals) {
  const byTime = new Map();
  const add = (time, amount) => { if (amount > 0) byTime.set(time, round3((byTime.get(time) ?? 0) + amount)); };
  for (const s of MEAL_SLOTS) add(meals[s.prefKey], Number(phase[s.key]) || 0);
  for (const s of parseSlots(phase.custom_slots)) if (TIME_RE.test(s.time)) add(s.time, s.amount);
  return [...byTime].map(([time, amount]) => ({ time, amount }));
}

// What is due at the wall-clock minute `now` ({ date: 'YYYY-MM-DD', hhmm: 'HH:MM' })?
// `regimens`: [{ id, as_needed, supplement_name, unit, take_with_food, start_date, target_date (YYYY-MM-DD), phases }].
// Returns { date, time, items: [...] } or null when nothing is due.
function dueNotifications({ now, prefs, regimens }) {
  const meals = normalizeSchedulePrefs(prefs);
  const items = [];
  for (const r of regimens) {
    if (r.as_needed) continue;
    const totalDays = dayIndex(r.start_date, r.target_date);
    const active = activePhase(r.phases ?? [], r.start_date, now.date, totalDays);
    if (!active || !isDosingDay(active.phase, now.date)) continue;
    const slots = slotsForPhase(active.phase, meals);
    const due = slots.find(s => s.time === now.hhmm);
    if (!due) continue;
    items.push({
      regimenId: r.id,
      supplement: r.supplement_name,
      amount: due.amount,
      unit: r.unit || 'capsules',
      withFood: !!r.take_with_food,
      // dose_log holds one row per regimen per day, so a tap may only log a regimen that has a single dose today.
      loggable: slots.length === 1,
    });
  }
  if (!items.length) return null;
  items.sort((a, b) => a.supplement.localeCompare(b.supplement) || a.regimenId.localeCompare(b.regimenId));
  return { date: now.date, time: now.hhmm, items };
}

const lineFor = it => `• ${formatAmount(it.amount)} ${unitShort(it.unit)} ${it.supplement}${it.withFood ? ' (with food)' : ''}`;

// The Web Push payload for a batch; truncated with "+N more" if it would exceed the size limit.
function buildPayload(batch) {
  const title = batch.items.length === 1
    ? `Time to take ${batch.items[0].supplement}`
    : `${formatTime12(batch.time)} — ${batch.items.length} supplements due`;
  const make = shown => {
    const lines = shown.map(lineFor);
    if (shown.length < batch.items.length) lines.push(`+${batch.items.length - shown.length} more`);
    return JSON.stringify({
      title,
      body: lines.join('\n'),
      tag: `dose-batch-${batch.date}-${batch.time.replace(':', '')}`,
      data: {
        url: '/',
        kind: 'dose',
        date: batch.date,
        regimenIds: shown.filter(i => i.loggable).map(i => i.regimenId),
      },
    });
  };
  let shown = batch.items;
  let payload = make(shown);
  while (Buffer.byteLength(payload) > PAYLOAD_LIMIT && shown.length > 1) {
    shown = shown.slice(0, -1);
    payload = make(shown);
  }
  return payload;
}

// Sends one payload to every subscription. `send(sub, payload)` is injected (web-push in production);
// subscriptions the push service reports gone (404/410) are handed to `onGone` for cleanup.
async function sendBatch({ batch, subscriptions, send, onGone }) {
  const payload = buildPayload(batch);
  let sent = 0;
  let failed = 0;
  await Promise.all(subscriptions.map(async sub => {
    try {
      await send(sub, payload);
      sent++;
    } catch (err) {
      failed++;
      if (err && (err.statusCode === 404 || err.statusCode === 410) && onGone) await onGone(sub);
    }
  }));
  return { sent, failed, payload };
}

// Remembers which minutes were already processed so a repeated cron tick, a 1-minute catch-up window
// and a repeated DST hour never notify twice. Keys are 'YYYY-MM-DD|HH:MM' in the owner's timezone.
function createDeduper() {
  const seen = new Set();
  return {
    has: key => seen.has(key),
    add: key => { seen.add(key); },
    // Keep only today's keys.
    prune(todayStr) { for (const k of seen) if (!k.startsWith(todayStr)) seen.delete(k); },
    get size() { return seen.size; },
  };
}

module.exports = {
  MEAL_DEFAULTS, PAYLOAD_LIMIT, normalizeSchedulePrefs, slotsForPhase, dueNotifications,
  buildPayload, sendBatch, createDeduper, formatTime12,
};
