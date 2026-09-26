// Meal-time dosing helpers — the single source of truth on the server.
// client/src/utils/dosing.js is its JS twin (a test keeps the two in agreement).
//
// A phase's daily dose = dose_morning + dose_lunch + dose_dinner + sum(custom_slots[].amount).
// custom_slots is JSONB: [{ amount: number > 0, time: "HH:MM" }]. Pg returns NUMERIC columns as
// strings, so everything is coerced with Number() and rounded to 1e-6 to keep float noise
// (0.1 + 0.2) from flipping coverage checks.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_CUSTOM_SLOTS = 12;
const MAX_AMOUNT = 100000;
const MAX_DURATION_DAYS = 3650;
const DAY_MS = 86400000;

const round6 = n => Math.round(n * 1e6) / 1e6;
const round3 = n => Math.round(n * 1000) / 1000;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// custom_slots may arrive as an array (JSONB) or a JSON string; anything malformed counts as none.
function parseSlots(raw) {
  let slots = raw;
  if (typeof raw === 'string') {
    try { slots = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(slots)) return [];
  return slots
    .filter(s => s && typeof s === 'object')
    .map(s => ({ amount: num(s.amount), time: String(s.time ?? '') }));
}

function dailyDose(phase) {
  // Old-shaped rows (before the dose_* columns existed) still carry only `dosage`.
  if (phase.dose_morning === undefined && phase.dose_lunch === undefined
    && phase.dose_dinner === undefined && phase.custom_slots === undefined) {
    return round6(num(phase.dosage));
  }
  const custom = parseSlots(phase.custom_slots).reduce((sum, s) => sum + s.amount, 0);
  return round6(num(phase.dose_morning) + num(phase.dose_lunch) + num(phase.dose_dinner) + custom);
}

// Same [0, MAX_AMOUNT] bound validatePhaseBody enforces via readAmount() on a normal create/update
// — a restore (backup/drive-restore) never goes through that, only isValidBackup's array/type
// shape check, so a hand-edited or corrupted backup's dose amounts need clamping here too.
const clampAmount = n => Math.min(MAX_AMOUNT, Math.max(0, n));

// Reads the dose fields of any stored phase row — a current one, a version-1 backup row or a legacy
// template row (flat `dosage`) — into the current shape, ready to INSERT (stringify custom_slots).
function normalizePhaseRow(row) {
  const hasNew = row.dose_morning !== undefined || row.dose_lunch !== undefined
    || row.dose_dinner !== undefined || row.custom_slots !== undefined;
  if (!hasNew) return { dose_morning: clampAmount(round3(num(row.dosage))), dose_lunch: 0, dose_dinner: 0, custom_slots: [] };
  return {
    dose_morning: clampAmount(round3(num(row.dose_morning))),
    dose_lunch: clampAmount(round3(num(row.dose_lunch))),
    dose_dinner: clampAmount(round3(num(row.dose_dinner))),
    custom_slots: parseSlots(row.custom_slots)
      .filter(s => s.amount > 0 && TIME_RE.test(s.time))
      .map(s => ({ amount: clampAmount(round3(s.amount)), time: s.time })),
  };
}

function averageDailyDose(phase) {
  const days = Array.isArray(phase.days_of_week) && phase.days_of_week.length ? phase.days_of_week.length : 7;
  return dailyDose(phase) * days / 7;
}

// Whole days of supply left for one supplement: `activePhases` are the currently active phase of
// every non-as-needed regimen using it. null = nothing is scheduled (days-mode alerts don't fire).
function supplementDaysRemaining(inventory, activePhases) {
  const perDay = activePhases.reduce((sum, p) => sum + averageDailyDose(p), 0);
  if (!(perDay > 0)) return null;
  return Math.floor(round6(Number(inventory) / perDay));
}

// ── Date math on 'YYYY-MM-DD' strings only (never Date-local getters or toISOString) ───────────
function ymdToUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}

function dayIndex(startStr, todayStr) {
  return Math.round((ymdToUtc(todayStr) - ymdToUtc(startStr)) / DAY_MS);
}

function dayOfWeek(dateStr) {
  return new Date(ymdToUtc(dateStr)).getUTCDay(); // 0 = Sunday
}

function isDosingDay(phase, dateStr) {
  const dow = Array.isArray(phase.days_of_week) && phase.days_of_week.length ? phase.days_of_week : null;
  return dow ? dow.includes(dayOfWeek(dateStr)) : true;
}

// Which phase covers `todayStr`? Session window is half-open, [start, start + totalDays): copying a
// session sets the new start to the old target date, so an inclusive window would make two sessions
// "active" on the handoff day. Phases are walked in sequence_order; an indefinite phase swallows the
// rest of the session (later phases are unreachable, as in the calculator); a 0-day phase is skipped.
// Returns { phase, index, dayInPhase } or null (before start, after end, or in an uncovered tail).
function activePhase(phases, startStr, todayStr, totalDays) {
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

// ── Request validation ──────────────────────────────────────────────────────────────────────
function readAmount(v, label, { min }) {
  if (v === undefined || v === null || v === '') return { value: 0 };
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > MAX_AMOUNT) return { error: `${label} must be a number between ${min} and ${MAX_AMOUNT}` };
  return { value: round3(n) };
}

// Normalises a phase POST/PUT body. A legacy body carrying only `dosage` maps to dose_morning so
// stale cached clients keep working. Returns { ok: true, value } or { ok: false, error }.
function validatePhaseBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  const legacy = b.dose_morning === undefined && b.dose_lunch === undefined && b.dose_dinner === undefined
    && b.custom_slots === undefined && b.dosage !== undefined;

  const amounts = {};
  const sources = legacy
    ? [['dose_morning', b.dosage, 'Dose']]
    : [['dose_morning', b.dose_morning, 'Breakfast dose'], ['dose_lunch', b.dose_lunch, 'Lunch dose'], ['dose_dinner', b.dose_dinner, 'Dinner dose']];
  for (const [key, raw, label] of sources) {
    const r = readAmount(raw, label, { min: 0 });
    if (r.error) return { ok: false, error: r.error };
    amounts[key] = r.value;
  }
  amounts.dose_morning ??= 0;
  amounts.dose_lunch ??= 0;
  amounts.dose_dinner ??= 0;

  let slots = [];
  if (b.custom_slots !== undefined && b.custom_slots !== null) {
    if (!Array.isArray(b.custom_slots)) return { ok: false, error: 'custom_slots must be a list' };
    if (b.custom_slots.length > MAX_CUSTOM_SLOTS) return { ok: false, error: `At most ${MAX_CUSTOM_SLOTS} custom doses per phase` };
    for (const s of b.custom_slots) {
      if (!s || typeof s !== 'object') return { ok: false, error: 'Each custom dose needs an amount and a time' };
      const r = readAmount(s.amount, 'Custom dose', { min: 0 });
      if (r.error) return { ok: false, error: r.error };
      if (!(r.value > 0)) return { ok: false, error: 'Custom dose amounts must be greater than 0' };
      if (typeof s.time !== 'string' || !TIME_RE.test(s.time)) return { ok: false, error: 'Custom dose times must be HH:MM (24-hour)' };
      slots.push({ amount: r.value, time: s.time });
    }
    slots.sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : x.amount - y.amount));
  }

  const total = round6(amounts.dose_morning + amounts.dose_lunch + amounts.dose_dinner + slots.reduce((sum, s) => sum + s.amount, 0));
  if (!(total > 0)) return { ok: false, error: 'At least one dose amount must be greater than 0' };

  const indefinite = !!b.indefinite;
  let duration = 9999; // indefinite phases are stored as 9999 + the flag (see docs/DECISIONS.md)
  if (!indefinite) {
    duration = Number(b.duration_days);
    if (!Number.isInteger(duration) || duration < 1 || duration > MAX_DURATION_DAYS) {
      return { ok: false, error: `Duration must be a whole number of days between 1 and ${MAX_DURATION_DAYS}` };
    }
  }

  let days = null;
  if (b.days_of_week !== undefined && b.days_of_week !== null) {
    if (!Array.isArray(b.days_of_week) || !b.days_of_week.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return { ok: false, error: 'days_of_week must be a list of weekday numbers 0-6' };
    }
    const unique = [...new Set(b.days_of_week)].sort((x, y) => x - y);
    days = unique.length && unique.length < 7 ? unique : null; // none / all seven = every day
  }

  return {
    ok: true,
    value: { ...amounts, custom_slots: slots, duration_days: duration, days_of_week: days, indefinite },
  };
}

module.exports = {
  TIME_RE, MAX_CUSTOM_SLOTS, round6, round3,
  parseSlots, dailyDose, normalizePhaseRow, averageDailyDose, supplementDaysRemaining,
  ymdToUtc, dayIndex, dayOfWeek, isDosingDay, activePhase, validatePhaseBody,
};
