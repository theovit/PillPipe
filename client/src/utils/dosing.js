// Meal-time dosing helpers — the JS twin of server/dosing.js. server/test/dosing-twin.test.js runs
// the same golden vectors through both so they cannot drift apart.
//
// A phase's daily dose = dose_morning + dose_lunch + dose_dinner + sum(custom_slots[].amount).
// Server NUMERIC columns arrive as strings, so everything is coerced and rounded.

// UI names are Breakfast/Lunch/Dinner (notation B L D); storage and pref keys keep the Android names.
export const SLOTS = [
  { key: 'dose_morning', prefKey: 'morningTime', label: 'Breakfast', letter: 'B' },
  { key: 'dose_lunch', prefKey: 'lunchTime', label: 'Lunch', letter: 'L' },
  { key: 'dose_dinner', prefKey: 'dinnerTime', label: 'Dinner', letter: 'D' },
];
export const MEAL_DEFAULTS = { morningTime: '08:00', lunchTime: '12:00', dinnerTime: '18:00' };
export const MAX_CUSTOM_SLOTS = 12;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DAY_MS = 86400000;
export const round6 = n => Math.round(n * 1e6) / 1e6;
export const round3 = n => Math.round(n * 1000) / 1000;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function parseSlots(raw) {
  let slots = raw;
  if (typeof raw === 'string') {
    try { slots = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(slots)) return [];
  return slots
    .filter(s => s && typeof s === 'object')
    .map(s => ({ amount: num(s.amount), time: String(s.time ?? '') }));
}

export function dailyDose(phase) {
  if (phase.dose_morning === undefined && phase.dose_lunch === undefined
    && phase.dose_dinner === undefined && phase.custom_slots === undefined) {
    return round6(num(phase.dosage));
  }
  const custom = parseSlots(phase.custom_slots).reduce((sum, s) => sum + s.amount, 0);
  return round6(num(phase.dose_morning) + num(phase.dose_lunch) + num(phase.dose_dinner) + custom);
}

// ── Dates on 'YYYY-MM-DD' strings (never Date-local getters) ────────────────────────────────────
function ymdToUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}
export const dayIndex = (startStr, todayStr) => Math.round((ymdToUtc(todayStr) - ymdToUtc(startStr)) / DAY_MS);

// Today's date in the owner's timezone (prefs.timezone). Falls back to the browser's own zone.
export function todayInTz(tz) {
  const fmt = zone => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date());
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  try { return fmt(tz || undefined); } catch { return fmt(undefined); }
}

// Which phase covers `todayStr`? Half-open session window; see server/dosing.js for the rules.
// Returns { phase, index, dayInPhase } or null.
export function activePhase(phases, startStr, todayStr, totalDays) {
  const idx = dayIndex(startStr, todayStr);
  if (!(idx >= 0 && idx < totalDays)) return null;
  const sorted = [...phases].sort((a, b) => a.sequence_order - b.sequence_order);
  let offset = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const duration = p.indefinite ? Infinity : Number(p.duration_days);
    if (!(duration > 0)) continue;
    if (idx < offset + duration) return { phase: p, index: i, dayInPhase: idx - offset };
    offset += duration;
  }
  return null;
}

// ── Formatting ──────────────────────────────────────────────────────────────────────────────
// Rounds away float noise: 0.30000000000000004 -> "0.3", 2 -> "2".
export const formatAmount = v => String(round3(num(v)));

export function unitShort(unit) {
  if (unit === 'ml') return 'ml';
  if (unit === 'drops') return 'drops';
  if (unit === 'tablets') return 'tabs';
  return 'caps';
}

export function formatTime12(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm));
  if (!m) return String(hhmm ?? '');
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// The saved meal times, with defaults for anything missing or malformed.
export function resolveMealTimes(prefs) {
  const out = {};
  for (const [k, def] of Object.entries(MEAL_DEFAULTS)) out[k] = TIME_RE.test(prefs?.[k] ?? '') ? prefs[k] : def;
  return out;
}

// Compact schedule of one phase: "B1 L1 D2 +1@2:30 PM" (breakfast/lunch/dinner amounts, then custom slots by time).
export function phaseNotation(phase) {
  const parts = SLOTS.filter(s => num(phase[s.key]) > 0).map(s => `${s.letter}${formatAmount(phase[s.key])}`);
  const custom = parseSlots(phase.custom_slots)
    .filter(s => s.amount > 0 && TIME_RE.test(s.time))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.amount - b.amount))
    .map(s => `+${formatAmount(s.amount)}@${formatTime12(s.time)}`);
  return [...parts, ...custom].join(' ') || '—';
}

export const totalLabel = (phase, unit) => `${formatAmount(dailyDose(phase))} ${unitShort(unit)}/day`;
