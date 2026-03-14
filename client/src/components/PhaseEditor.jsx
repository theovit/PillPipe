import { useState } from 'react';
import { api } from '../utils/api';

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

function formatSchedule(phase) {
  if (!phase.days_of_week || phase.days_of_week.length === 0) {
    return `${phase.dosage} pill${phase.dosage !== 1 ? 's' : ''}/day`;
  }
  const names = phase.days_of_week
    .slice()
    .sort((a, b) => a - b)
    .map(d => DAYS[d].label)
    .join(' ');
  return `${phase.dosage} pill${phase.dosage !== 1 ? 's' : ''} · ${names}`;
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
const EMPTY_FORM = (days) => ({ dosage: '', duration_days: days ?? '', days_of_week: [], indefinite: false });

export default function PhaseEditor({ regimenId, phases, onUpdate, sessionTotalDays }) {
  const definedDays = phases.filter(p => !p.indefinite).reduce((sum, p) => sum + p.duration_days, 0);
  const hasIndefinite = phases.some(p => p.indefinite);
  const remainingDays = sessionTotalDays ? Math.max(0, sessionTotalDays - definedDays) : null;

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM(remainingDays ?? sessionTotalDays));
  const [addUnit, setAddUnit] = useState(() => defaultUnit(remainingDays ?? sessionTotalDays));
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editUnit, setEditUnit] = useState('d');

  function startEdit(p) {
    setEditingId(p.id);
    setEditUnit(defaultUnit(p.duration_days));
    setEditForm({
      dosage: p.dosage,
      duration_days: p.duration_days,
      days_of_week: p.days_of_week || [],
      indefinite: !!p.indefinite,
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    const phase = phases.find(p => p.id === editingId);
    await api.updatePhase(editingId, {
      dosage: parseInt(editForm.dosage),
      duration_days: parseInt(editForm.duration_days) || 0,
      days_of_week: editForm.days_of_week.length > 0 ? editForm.days_of_week : null,
      sequence_order: phase.sequence_order,
      indefinite: !!editForm.indefinite,
    });
    setEditingId(null);
    onUpdate();
  }

  async function addPhase(e) {
    e.preventDefault();
    await api.createPhase(regimenId, {
      dosage: parseInt(form.dosage),
      duration_days: parseInt(form.duration_days) || 0,
      days_of_week: form.days_of_week.length > 0 ? form.days_of_week : null,
      sequence_order: phases.length + 1,
      indefinite: !!form.indefinite,
    });
    setForm(EMPTY_FORM(remainingDays ?? sessionTotalDays));
    setAddUnit(defaultUnit(remainingDays ?? sessionTotalDays));
    setAdding(false);
    onUpdate();
  }

  async function deletePhase(id) {
    await api.deletePhase(id);
    onUpdate();
  }

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

  return (
    <div className="space-y-2">
      {phases.length === 0 && (
        <p className="text-xs text-gray-500 italic">No phases yet</p>
      )}
      {phases.map((p, i) => (
        <div key={p.id}>
          {editingId === p.id ? (
            <form onSubmit={saveEdit} className="space-y-3 bg-gray-800/50 rounded px-3 py-3">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Pills/dose</label>
                  <input type="number" min="1" required value={editForm.dosage}
                    onChange={e => setEditForm(f => ({ ...f, dosage: e.target.value }))}
                    className={`w-24 ${inputCls}`} />
                </div>
                <SpanField
                  duration_days={editForm.duration_days}
                  unit={editUnit}
                  onDurationChange={val => setEditForm(f => ({ ...f, duration_days: val }))}
                  onUnitChange={setEditUnit}
                  indefinite={!!editForm.indefinite}
                  onIndefiniteChange={val => setEditForm(f => ({ ...f, indefinite: val }))}
                />
              </div>
              <DayPicker selected={editForm.days_of_week} onChange={val => setEditForm(f => ({ ...f, days_of_week: val }))} />
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2.5 sm:py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">Save</button>
                <button type="button" onClick={() => setEditingId(null)} className="px-4 py-2.5 sm:py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-2 text-sm bg-gray-800/50 rounded px-3 py-3 sm:py-2">
              <span className="text-gray-400 w-6 shrink-0">#{i + 1}</span>
              <span className="flex-1 text-gray-200 min-w-0">{formatSchedule(p)}</span>
              <span className={`shrink-0 ${p.indefinite ? 'text-violet-400' : 'text-gray-400'}`}>{formatDuration(p)}</span>
              <button onClick={() => startEdit(p)} className="text-gray-500 hover:text-gray-300 p-2 shrink-0">✎</button>
              <button onClick={() => deletePhase(p.id)} className="text-red-500 hover:text-red-400 p-2 shrink-0">✕</button>
            </div>
          )}
        </div>
      ))}

      {sessionTotalDays > 0 && phases.length > 0 && (
        <div className="text-xs text-gray-500 pt-1">
          {hasIndefinite ? (
            <span>{definedDays}d + <span className="text-violet-400">∞</span> · <span className="text-green-500">session fully covered</span></span>
          ) : (
            <>
              {definedDays}d of {sessionTotalDays}d allocated
              {definedDays < sessionTotalDays && <span className="text-violet-400"> · {remainingDays}d remaining</span>}
              {definedDays === sessionTotalDays && <span className="text-green-500"> · fully covered</span>}
              {definedDays > sessionTotalDays && <span className="text-amber-400"> · {definedDays - sessionTotalDays}d over session length</span>}
            </>
          )}
        </div>
      )}

      {adding ? (
        <form onSubmit={addPhase} className="space-y-3 pt-1">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Pills/dose</label>
              <input type="number" min="1" required value={form.dosage}
                onChange={e => setForm(f => ({ ...f, dosage: e.target.value }))}
                className={`w-24 ${inputCls}`} />
            </div>
            <SpanField
              duration_days={form.duration_days}
              unit={addUnit}
              onDurationChange={val => setForm(f => ({ ...f, duration_days: val }))}
              onUnitChange={setAddUnit}
              indefinite={!!form.indefinite}
              onIndefiniteChange={val => setForm(f => ({ ...f, indefinite: val }))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Dosing days <span className="text-gray-600">(leave empty = every day)</span>
            </label>
            <DayPicker selected={form.days_of_week} onChange={val => setForm(f => ({ ...f, days_of_week: val }))} />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2.5 sm:py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">Add</button>
            <button type="button"
              onClick={() => { setAdding(false); setForm(EMPTY_FORM(remainingDays ?? sessionTotalDays)); setAddUnit(defaultUnit(remainingDays ?? sessionTotalDays)); }}
              className="px-4 py-2.5 sm:py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => { setForm(EMPTY_FORM(remainingDays ?? sessionTotalDays)); setAddUnit(defaultUnit(remainingDays ?? sessionTotalDays)); setAdding(true); }}
          className="text-sm text-violet-400 hover:text-violet-300 py-2 mt-1">
          + Add phase
        </button>
      )}
    </div>
  );
}
