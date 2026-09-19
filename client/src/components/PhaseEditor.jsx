import { useState } from 'react';
import { api } from '../utils/api';
import { loadPrefs } from '../utils/prefs';
import {
  MAX_CUSTOM_SLOTS, SLOTS, TIME_RE, dailyDose, formatAmount, formatTime12, parseSlots,
  phaseNotation, resolveMealTimes, round3, totalLabel, unitShort,
} from '../utils/dosing';

const DAYS = [
  { label: 'Su', value: 0 },
  { label: 'Mo', value: 1 },
  { label: 'Tu', value: 2 },
  { label: 'We', value: 3 },
  { label: 'Th', value: 4 },
  { label: 'Fr', value: 5 },
  { label: 'Sa', value: 6 },
];

function formatDuration(phase) {
  if (phase.indefinite) return '∞';
  if (phase.duration_days % 7 === 0 && phase.duration_days >= 7) return `${phase.duration_days / 7}wk`;
  return `${phase.duration_days}d`;
}

function daysText(phase) {
  if (!phase.days_of_week || phase.days_of_week.length === 0) return '';
  return ' · ' + phase.days_of_week.slice().sort((a, b) => a - b).map(d => DAYS[d].label).join(' ');
}

function DayPicker({ selected, onChange }) {
  function toggle(val) {
    onChange(selected.includes(val) ? selected.filter(d => d !== val) : [...selected, val]);
  }
  return (
    <div className="flex gap-1">
      {DAYS.map(d => (
        <button key={d.value} type="button" onClick={() => toggle(d.value)}
          className={`flex-1 h-9 sm:h-8 rounded text-xs font-medium transition-colors ${
            selected.includes(d.value)
              ? 'bg-violet-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}>
          {d.label}
        </button>
      ))}
    </div>
  );
}

function UnitToggle({ unit, onChange }) {
  return (
    <button type="button" onClick={() => onChange(unit === 'd' ? 'w' : 'd')}
      className="px-3 py-2.5 sm:py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 font-medium">
      {unit}
    </button>
  );
}

function durationDisplay(days, unit) {
  if (!days && days !== 0) return '';
  if (unit === 'w') return String(Math.round(days / 7));
  return String(days);
}

function durationToDays(val, unit) {
  const n = parseInt(val) || 0;
  return unit === 'w' ? n * 7 : n;
}

function defaultUnit(duration_days) {
  return duration_days && duration_days % 7 === 0 && duration_days >= 7 ? 'w' : 'd';
}

const inputCls = 'rounded bg-gray-800 border border-gray-700 px-3 py-2.5 sm:py-1.5 text-base sm:text-sm text-gray-200 focus:outline-none focus:border-violet-500';
const EMPTY_FORM = (days) => ({ dose_morning: '', dose_lunch: '', dose_dinner: '', slots: [], duration_days: days ?? '', days_of_week: [], indefinite: false });

function IndefiniteToggle({ checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none py-1">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="accent-violet-500 w-4 h-4" />
      Indefinite
    </label>
  );
}

function SpanField({ duration_days, unit, onDurationChange, onUnitChange, indefinite, onIndefiniteChange }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">Span</label>
      {indefinite ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-violet-400 font-medium py-2.5">∞ fills session</span>
          <IndefiniteToggle checked={indefinite} onChange={onIndefiniteChange} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5 items-center">
            <input type="number" min="1" required={!indefinite}
              value={durationDisplay(duration_days, unit)}
              onChange={e => onDurationChange(durationToDays(e.target.value, unit))}
              className={`w-24 ${inputCls}`} />
            <UnitToggle unit={unit} onChange={onUnitChange} />
          </div>
          <IndefiniteToggle checked={indefinite} onChange={onIndefiniteChange} />
        </div>
      )}
    </div>
  );
}

// ── Form <-> API conversion ──────────────────────────────────────────────────────────────────
function formFromPhase(p) {
  const show = v => (Number(v) > 0 ? String(round3(Number(v))) : '');
  return {
    dose_morning: show(p.dose_morning),
    dose_lunch: show(p.dose_lunch),
    dose_dinner: show(p.dose_dinner),
    slots: parseSlots(p.custom_slots).map(s => ({ amount: String(s.amount), time: s.time })),
    duration_days: p.duration_days,
    days_of_week: p.days_of_week || [],
    indefinite: !!p.indefinite,
  };
}

// Returns { payload } or { error }. Amounts may be fractional for every unit.
function payloadFromForm(f) {
  const payload = {};
  for (const s of SLOTS) {
    const raw = String(f[s.key] ?? '').trim();
    const n = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0) return { error: `${s.label} amount must be 0 or more` };
    payload[s.key] = n;
  }
  const slots = [];
  for (const s of f.slots) {
    const n = String(s.amount ?? '').trim() === '' ? NaN : Number(s.amount);
    if (!(n > 0) || !TIME_RE.test(s.time || '')) return { error: 'Each custom dose needs an amount above 0 and a time' };
    slots.push({ amount: n, time: s.time });
  }
  payload.custom_slots = slots;
  if (!(dailyDose(payload) > 0)) return { error: 'Enter at least one dose amount' };
  const days = parseInt(f.duration_days) || 0;
  if (!f.indefinite && days < 1) return { error: 'Enter how long this phase lasts' };
  payload.duration_days = f.indefinite ? 9999 : days;
  payload.days_of_week = f.days_of_week.length > 0 ? f.days_of_week : null;
  payload.indefinite = !!f.indefinite;
  return { payload };
}

function PhaseForm({ form, setForm, unit, durUnit, onDurUnit, error, onSubmit, onCancel, submitLabel, showDaysLabel }) {
  const meals = resolveMealTimes(loadPrefs());
  const short = unitShort(unit);
  const draft = payloadFromForm(form);
  const total = draft.payload ? dailyDose(draft.payload) : dailyDose({
    dose_morning: form.dose_morning, dose_lunch: form.dose_lunch, dose_dinner: form.dose_dinner,
    custom_slots: form.slots.map(s => ({ amount: s.amount, time: s.time })),
  });

  function setSlot(i, patch) {
    setForm(f => ({ ...f, slots: f.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 bg-gray-800/50 rounded px-3 py-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Amount per dose <span className="text-gray-600">({short} — leave a meal at 0 to skip it)</span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {SLOTS.map(s => (
            <div key={s.key}>
              <div className="flex items-baseline justify-between gap-1 mb-1">
                <span className="text-xs text-gray-400">{s.label}</span>
                <span className="text-[10px] text-gray-600 font-mono">{formatTime12(meals[s.prefKey])}</span>
              </div>
              <input type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                aria-label={`${s.label} amount`}
                value={form[s.key]}
                onChange={e => setForm(f => ({ ...f, [s.key]: e.target.value }))}
                className={`w-full ${inputCls}`} />
            </div>
          ))}
        </div>
      </div>

      {form.slots.length > 0 && (
        <div className="space-y-1.5">
          <label className="block text-xs text-gray-500">Custom times</label>
          {form.slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="time" required value={s.time} aria-label="Custom dose time"
                onChange={e => setSlot(i, { time: e.target.value })}
                className={`w-32 ${inputCls}`} />
              <input type="number" min="0" step="any" inputMode="decimal" placeholder="0" required
                aria-label="Custom dose amount" value={s.amount}
                onChange={e => setSlot(i, { amount: e.target.value })}
                className={`w-24 ${inputCls}`} />
              <span className="text-xs text-gray-500">{short}</span>
              <button type="button" aria-label="Remove custom dose"
                onClick={() => setForm(f => ({ ...f, slots: f.slots.filter((_, j) => j !== i) }))}
                className="text-red-500 hover:text-red-400 p-2 ml-auto">✕</button>
            </div>
          ))}
        </div>
      )}
      {form.slots.length < MAX_CUSTOM_SLOTS && (
        <button type="button"
          onClick={() => setForm(f => ({ ...f, slots: [...f.slots, { amount: '', time: '12:00' }] }))}
          className="text-xs text-violet-400 hover:text-violet-300">
          + Add custom time
        </button>
      )}

      <p className="text-xs text-gray-500 font-mono">
        Total: <span className="text-gray-300">{formatAmount(total)} {short}/day</span>
      </p>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
        <SpanField
          duration_days={form.duration_days}
          unit={durUnit}
          onDurationChange={val => setForm(f => ({ ...f, duration_days: val }))}
          onUnitChange={onDurUnit}
          indefinite={!!form.indefinite}
          onIndefiniteChange={val => setForm(f => ({ ...f, indefinite: val }))}
        />
      </div>
      <div>
        {showDaysLabel && (
          <label className="block text-xs text-gray-500 mb-1">
            Dosing days <span className="text-gray-600">(leave empty = every day)</span>
          </label>
        )}
        <DayPicker selected={form.days_of_week} onChange={val => setForm(f => ({ ...f, days_of_week: val }))} />
      </div>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="px-4 py-2.5 sm:py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">{submitLabel}</button>
        <button type="button" onClick={onCancel} className="px-4 py-2.5 sm:py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
      </div>
    </form>
  );
}

export default function PhaseEditor({ regimenId, phases, onUpdate, sessionTotalDays, unit = 'capsules' }) {
  const definedDays = phases.filter(p => !p.indefinite).reduce((sum, p) => sum + p.duration_days, 0);
  const hasIndefinite = phases.some(p => p.indefinite);
  const remainingDays = sessionTotalDays ? Math.max(0, sessionTotalDays - definedDays) : null;

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM(remainingDays ?? sessionTotalDays));
  const [addUnit, setAddUnit] = useState(() => defaultUnit(remainingDays ?? sessionTotalDays));
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editUnit, setEditUnit] = useState('d');
  const [error, setError] = useState('');

  function startAdd() {
    setForm(EMPTY_FORM(remainingDays ?? sessionTotalDays));
    setAddUnit(defaultUnit(remainingDays ?? sessionTotalDays));
    setError('');
    setAdding(true);
  }

  function startEdit(p) {
    setEditingId(p.id);
    setEditUnit(defaultUnit(p.duration_days));
    setEditForm(formFromPhase(p));
    setError('');
  }

  async function saveEdit(e) {
    e.preventDefault();
    const r = payloadFromForm(editForm);
    if (r.error) return setError(r.error);
    try {
      await api.updatePhase(editingId, r.payload);
    } catch (err) {
      return setError(err.message);
    }
    setEditingId(null);
    setError('');
    onUpdate();
  }

  async function addPhase(e) {
    e.preventDefault();
    const r = payloadFromForm(form);
    if (r.error) return setError(r.error);
    try {
      await api.createPhase(regimenId, r.payload); // the server assigns the phase order
    } catch (err) {
      return setError(err.message);
    }
    setAdding(false);
    setError('');
    onUpdate();
  }

  async function deletePhase(id) {
    await api.deletePhase(id);
    onUpdate();
  }

  return (
    <div className="space-y-2">
      {phases.length === 0 && (
        <p className="text-xs text-gray-500 italic">No phases yet</p>
      )}
      {phases.map((p, i) => (
        <div key={p.id}>
          {editingId === p.id ? (
            <PhaseForm form={editForm} setForm={setEditForm} unit={unit}
              durUnit={editUnit} onDurUnit={setEditUnit} error={error}
              onSubmit={saveEdit} onCancel={() => { setEditingId(null); setError(''); }}
              submitLabel="Save" />
          ) : (
            <div className="flex items-center justify-between gap-2 text-sm bg-gray-800/50 rounded px-3 py-3 sm:py-2">
              <span className="text-gray-600 w-5 shrink-0 font-mono text-xs">#{i + 1}</span>
              <span className="flex-1 text-gray-200 min-w-0">
                <span className="font-mono">{phaseNotation(p)}</span>
                <span className="text-gray-500"> · {totalLabel(p, unit)}{daysText(p)}</span>
              </span>
              <span className={`shrink-0 font-mono text-xs ${p.indefinite ? 'text-violet-400' : 'text-gray-400'}`}>{formatDuration(p)}</span>
              <button onClick={() => startEdit(p)} className="text-gray-500 hover:text-gray-300 p-2 shrink-0">✎</button>
              <button onClick={() => deletePhase(p.id)} className="text-red-500 hover:text-red-400 p-2 shrink-0">✕</button>
            </div>
          )}
        </div>
      ))}

      {sessionTotalDays > 0 && phases.length > 0 && (
        <div className="text-xs text-gray-500 pt-1 font-mono">
          {hasIndefinite ? (
            <span>{definedDays}d + <span className="text-violet-400">∞</span> · <span className="text-green-500">session fully covered</span></span>
          ) : (
            <>
              {definedDays}d of {sessionTotalDays}d allocated
              {definedDays < sessionTotalDays && <span className="text-violet-400"> · {remainingDays}d remaining</span>}
              {definedDays === sessionTotalDays && <span className="text-green-500"> · fully covered</span>}
              {definedDays > sessionTotalDays && <span className="text-amber-400"> · {definedDays - sessionTotalDays}d over</span>}
            </>
          )}
        </div>
      )}

      {adding ? (
        <PhaseForm form={form} setForm={setForm} unit={unit}
          durUnit={addUnit} onDurUnit={setAddUnit} error={error}
          onSubmit={addPhase} onCancel={() => { setAdding(false); setError(''); }}
          submitLabel="Add" showDaysLabel />
      ) : (
        <button onClick={startAdd} className="text-sm text-violet-400 hover:text-violet-300 py-2 mt-1">
          + Add phase
        </button>
      )}
    </div>
  );
}
