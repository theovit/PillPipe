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

function formatDuration(days) {
  if (days % 7 === 0 && days >= 7) return `${days / 7}wk`;
  return `${days}d`;
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
          className={`w-8 h-8 rounded text-xs font-medium transition-colors ${
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
      className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 font-medium w-8">
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

const EMPTY_FORM = (days) => ({ dosage: '', duration_days: days ?? '', days_of_week: [] });

export default function PhaseEditor({ regimenId, phases, onUpdate, sessionTotalDays }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM(sessionTotalDays));
  const [addUnit, setAddUnit] = useState(() => defaultUnit(sessionTotalDays));
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
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    const phase = phases.find(p => p.id === editingId);
    await api.updatePhase(editingId, {
      dosage: parseInt(editForm.dosage),
      duration_days: parseInt(editForm.duration_days),
      days_of_week: editForm.days_of_week.length > 0 ? editForm.days_of_week : null,
      sequence_order: phase.sequence_order,
    });
    setEditingId(null);
    onUpdate();
  }

  async function addPhase(e) {
    e.preventDefault();
    await api.createPhase(regimenId, {
      dosage: parseInt(form.dosage),
      duration_days: parseInt(form.duration_days),
      days_of_week: form.days_of_week.length > 0 ? form.days_of_week : null,
      sequence_order: phases.length + 1,
    });
    setForm(EMPTY_FORM(sessionTotalDays));
    setAddUnit(defaultUnit(sessionTotalDays));
    setAdding(false);
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
            <form onSubmit={saveEdit} className="space-y-2 bg-gray-800/50 rounded px-3 py-2">
              <div className="flex gap-2 items-end">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Pills/dose</label>
                  <input type="number" min="1" required value={editForm.dosage}
                    onChange={e => setEditForm(f => ({ ...f, dosage: e.target.value }))}
                    className="w-20 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-violet-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Span</label>
                  <div className="flex gap-1 items-center">
                    <input type="number" min="1" required
                      value={durationDisplay(editForm.duration_days, editUnit)}
                      onChange={e => setEditForm(f => ({ ...f, duration_days: durationToDays(e.target.value, editUnit) }))}
                      className="w-20 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-violet-500" />
                    <UnitToggle unit={editUnit} onChange={setEditUnit} />
                  </div>
                </div>
              </div>
              <DayPicker selected={editForm.days_of_week} onChange={val => setEditForm(f => ({ ...f, days_of_week: val }))} />
              <div className="flex gap-2">
                <button type="submit" className="px-3 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm">Save</button>
                <button type="button" onClick={() => setEditingId(null)} className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-3 text-sm bg-gray-800/50 rounded px-3 py-2">
              <span className="text-gray-400 w-6">#{i + 1}</span>
              <span className="flex-1 text-gray-200">{formatSchedule(p)}</span>
              <span className="text-gray-400">{formatDuration(p.duration_days)}</span>
              <button onClick={() => startEdit(p)} className="text-gray-500 hover:text-gray-300 text-xs px-1">✎</button>
              <button onClick={() => deletePhase(p.id)} className="text-red-500 hover:text-red-400 text-xs px-1">✕</button>
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <form onSubmit={addPhase} className="space-y-2 pt-1">
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Pills/dose</label>
              <input type="number" min="1" required value={form.dosage}
                onChange={e => setForm(f => ({ ...f, dosage: e.target.value }))}
                className="w-20 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-violet-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Span</label>
              <div className="flex gap-1 items-center">
                <input type="number" min="1" required
                  value={durationDisplay(form.duration_days, addUnit)}
                  onChange={e => setForm(f => ({ ...f, duration_days: durationToDays(e.target.value, addUnit) }))}
                  className="w-20 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-violet-500" />
                <UnitToggle unit={addUnit} onChange={setAddUnit} />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Dosing days <span className="text-gray-600">(leave empty = every day)</span>
            </label>
            <DayPicker selected={form.days_of_week} onChange={val => setForm(f => ({ ...f, days_of_week: val }))} />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-3 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm">Add</button>
            <button type="button" onClick={() => { setAdding(false); setForm(EMPTY_FORM(sessionTotalDays)); setAddUnit(defaultUnit(sessionTotalDays)); }}
              className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
          </div>
        </form>
      ) : (
        <button onClick={() => { setForm(EMPTY_FORM(sessionTotalDays)); setAddUnit(defaultUnit(sessionTotalDays)); setAdding(true); }}
          className="text-xs text-violet-400 hover:text-violet-300 mt-1">
          + Add phase
        </button>
      )}
    </div>
  );
}
