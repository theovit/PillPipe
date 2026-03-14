import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import PhaseEditor from './PhaseEditor';
import ShortfallAlert from './ShortfallAlert';
import SupplementsPanel from './SupplementsPanel';

const today = new Date().toISOString().slice(0, 10);

export default function Dashboard() {
  const [supplements, setSupplements] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [regimens, setRegimens] = useState([]);
  const [phases, setPhases] = useState({});
  const [calcResults, setCalcResults] = useState({});
  const [sessionForm, setSessionForm] = useState({ start_date: today, target_date: '', notes: '' });
  const [editingSession, setEditingSession] = useState(null);
  const [copyingSession, setCopyingSession] = useState(null);
  const [copyForm, setCopyForm] = useState({ start_date: today, target_date: '' });
  const [regimenForm, setRegimenForm] = useState({ supplement_id: '' });
  const [view, setView] = useState('regimens');

  useEffect(() => { loadSupplements(); loadSessions(); }, []);

  async function loadSupplements() {
    setSupplements(await api.getSupplements());
  }

  async function loadSessions() {
    const data = await api.getSessions();
    setSessions(data);
    if (data.length && !activeSession) setActiveSession(data[0]);
  }

  useEffect(() => {
    if (activeSession) loadRegimens();
  }, [activeSession]);

  async function loadRegimens() {
    const data = await api.getRegimens(activeSession.id);
    setRegimens(data);
    const phasesMap = {};
    for (const r of data) {
      phasesMap[r.id] = await api.getPhases(r.id);
    }
    setPhases(phasesMap);
  }

  async function loadPhases(regimenId) {
    const data = await api.getPhases(regimenId);
    setPhases(p => ({ ...p, [regimenId]: data }));
  }

  async function createSession(e) {
    e.preventDefault();
    const s = await api.createSession(sessionForm);
    setSessionForm({ start_date: today, target_date: '', notes: '' });
    setSessions(prev => [s, ...prev]);
    setActiveSession(s);
  }

  async function createRegimen(e) {
    e.preventDefault();
    await api.createRegimen(activeSession.id, { supplement_id: regimenForm.supplement_id });
    setRegimenForm({ supplement_id: '' });
    loadRegimens();
  }

  async function runCalculate() {
    const { results } = await api.calculate(activeSession.id);
    const map = {};
    for (const r of results) map[r.regimen_id] = r;
    setCalcResults(map);
  }

  async function saveSession(e) {
    e.preventDefault();
    const updated = await api.updateSession(editingSession.id, {
      start_date: editingSession.start_date,
      target_date: editingSession.target_date,
      notes: editingSession.notes || null,
    });
    setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
    if (activeSession?.id === updated.id) setActiveSession(updated);
    setEditingSession(null);
  }

  async function deleteSession(id) {
    await api.deleteSession(id);
    const remaining = sessions.filter(s => s.id !== id);
    setSessions(remaining);
    setActiveSession(remaining[0] ?? null);
    if (remaining[0]) setRegimens([]);
  }

  async function submitCopySession(e) {
    e.preventDefault();
    const s = await api.copySession(copyingSession, copyForm);
    setCopyingSession(null);
    setSessions(prev => [s, ...prev]);
    setActiveSession(s);
    setCalcResults({});
  }

  async function deleteRegimen(id) {
    await api.deleteRegimen(id);
    loadRegimens();
  }

  const inputCls = 'w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-violet-500';

  function daysLeftBadge(targetDate) {
    const d = Math.ceil((new Date(targetDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (d < 0) return <span className="text-xs text-red-400">{Math.abs(d)}d overdue</span>;
    return <span className="text-xs text-violet-400">{d}d left</span>;
  }

  const totalCost = Object.keys(calcResults).length > 0
    ? Object.values(calcResults).reduce((sum, r) => sum + (r.estimatedCost || 0), 0)
    : null;

  const sessionTotalDays = activeSession
    ? Math.ceil((new Date(activeSession.target_date) - new Date(activeSession.start_date)) / (1000 * 60 * 60 * 24))
    : 0;

  const daysLeft = activeSession
    ? Math.ceil((new Date(activeSession.target_date) - new Date()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">PillPipe</h1>
          <p className="text-gray-500 text-sm mt-1">Supplement inventory & shortfall tracking</p>
        </div>
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          <button onClick={() => setView('regimens')}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${view === 'regimens' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
            Regimens
          </button>
          <button onClick={() => setView('supplements')}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${view === 'supplements' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
            Supplements
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sidebar: Sessions */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Sessions</h2>
            <form onSubmit={createSession} className="space-y-2 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start date</label>
                <input type="date" required value={sessionForm.start_date}
                  onChange={e => setSessionForm(f => ({ ...f, start_date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Target date</label>
                <input type="date" required value={sessionForm.target_date}
                  onChange={e => setSessionForm(f => ({ ...f, target_date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes <span className="text-gray-600">(optional)</span></label>
                <textarea rows={2} value={sessionForm.notes}
                  onChange={e => setSessionForm(f => ({ ...f, notes: e.target.value }))}
                  className={`${inputCls} resize-none`}
                  placeholder="e.g. Dr. Smith — taper off LDN after 3mo" />
              </div>
              <button type="submit" className="w-full py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
                New Session
              </button>
            </form>
            <div className="space-y-1">
              {sessions.map(s => (
                <div key={s.id}>
                  <div className={`rounded px-3 py-2 text-sm transition-colors ${
                    activeSession?.id === s.id
                      ? 'bg-violet-700/30 border border-violet-600/40 text-violet-300'
                      : 'hover:bg-gray-800 text-gray-400'
                  }`}>
                    {editingSession?.id === s.id ? (
                      <form onSubmit={saveSession} className="space-y-1">
                        <input type="date" required value={editingSession.start_date}
                          onChange={e => setEditingSession(f => ({ ...f, start_date: e.target.value }))}
                          className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-violet-500" />
                        <input type="date" required value={editingSession.target_date}
                          onChange={e => setEditingSession(f => ({ ...f, target_date: e.target.value }))}
                          className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-violet-500" />
                        <textarea rows={2} value={editingSession.notes || ''}
                          onChange={e => setEditingSession(f => ({ ...f, notes: e.target.value }))}
                          className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-violet-500 resize-none"
                          placeholder="Notes" />
                        <div className="flex gap-1 pt-0.5">
                          <button type="submit" className="px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs">Save</button>
                          <button type="button" onClick={() => setEditingSession(null)} className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs">Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-start gap-1">
                        <button className="flex-1 text-left" onClick={() => { setActiveSession(s); setCalcResults({}); }}>
                          <div className="font-medium flex items-center gap-2">
                            → {new Date(s.target_date).toLocaleDateString()}
                            {daysLeftBadge(s.target_date)}
                          </div>
                          <div className="text-xs opacity-60">from {new Date(s.start_date).toLocaleDateString()}</div>
                          {s.notes && <div className="text-xs opacity-50 mt-0.5 line-clamp-2">{s.notes}</div>}
                        </button>
                        <button onClick={() => { setCopyingSession(s.id); setCopyForm({ start_date: today, target_date: '' }); }}
                          className="text-gray-500 hover:text-gray-300 text-xs px-1 shrink-0 mt-0.5" title="Copy to new session">⊕</button>
                        <button onClick={() => setEditingSession({ ...s, start_date: s.start_date.slice(0, 10), target_date: s.target_date.slice(0, 10), notes: s.notes || '' })}
                          className="text-gray-500 hover:text-gray-300 text-xs px-1 shrink-0 mt-0.5">✎</button>
                        <button onClick={() => deleteSession(s.id)}
                          className="text-red-500 hover:text-red-400 text-xs px-1 shrink-0 mt-0.5">✕</button>
                      </div>
                    )}
                  </div>
                  {copyingSession === s.id && (
                    <form onSubmit={submitCopySession} className="mt-1 space-y-1 px-3 py-2 bg-gray-800/50 rounded border border-gray-700">
                      <p className="text-xs text-gray-400 font-medium">Copy to new session</p>
                      <input type="date" required value={copyForm.start_date}
                        onChange={e => setCopyForm(f => ({ ...f, start_date: e.target.value }))}
                        className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-violet-500" />
                      <input type="date" required value={copyForm.target_date}
                        onChange={e => setCopyForm(f => ({ ...f, target_date: e.target.value }))}
                        className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-violet-500" />
                      <div className="flex gap-1 pt-0.5">
                        <button type="submit" className="px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs">Copy</button>
                        <button type="button" onClick={() => setCopyingSession(null)} className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs">Cancel</button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main panel */}
        <div className="lg:col-span-2 space-y-4">
          {view === 'supplements' ? (
            <SupplementsPanel supplements={supplements} onUpdate={loadSupplements} />
          ) : activeSession ? (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                    Regimens — Target: {new Date(activeSession.target_date).toLocaleDateString()}
                    {daysLeft >= 0
                      ? <span className="ml-2 text-violet-400 font-normal normal-case">· {daysLeft} days left</span>
                      : <span className="ml-2 text-red-400 font-normal normal-case">· {Math.abs(daysLeft)} days overdue</span>
                    }
                  </h2>
                  {totalCost !== null && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Total to buy: <span className="text-violet-300 font-medium">${totalCost.toFixed(2)}</span>
                    </p>
                  )}
                </div>
                <button
                  onClick={runCalculate}
                  className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium shrink-0"
                >
                  Calculate
                </button>
              </div>

              {/* Add regimen */}
              <form onSubmit={createRegimen} className="rounded-xl bg-gray-900 border border-gray-800 p-4 flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Supplement</label>
                  <select required value={regimenForm.supplement_id}
                    onChange={e => setRegimenForm(f => ({ ...f, supplement_id: e.target.value }))}
                    className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500">
                    <option value="">Select…</option>
                    {supplements.map(s => (
                      <option key={s.id} value={s.id}>{s.name}{s.brand ? ` (${s.brand})` : ''} — {s.current_inventory} on hand</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="px-4 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
                  Add
                </button>
              </form>

              {/* Regimen cards */}
              {regimens.map(r => (
                <div key={r.id} className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-white">{r.supplement_name}</h3>
                      <p className="text-xs text-gray-500">{r.brand} · {r.pills_per_bottle} pills/bottle · ${Number(r.price).toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400">
                        {calcResults[r.id] != null
                          ? calcResults[r.id].currentOnHand
                          : r.current_inventory} pills on hand
                      </span>
                      <button onClick={() => deleteRegimen(r.id)} className="text-red-500 hover:text-red-400 text-xs">✕</button>
                    </div>
                  </div>

                  <PhaseEditor
                    regimenId={r.id}
                    phases={phases[r.id] || []}
                    onUpdate={() => loadPhases(r.id)}
                    sessionTotalDays={sessionTotalDays}
                  />

                  {calcResults[r.id] && (
                    <ShortfallAlert result={calcResults[r.id]} supplementName={r.supplement_name} />
                  )}
                </div>
              ))}

              {regimens.length === 0 && (
                <p className="text-center text-gray-600 py-8">No regimens yet. Add a supplement above.</p>
              )}
            </>
          ) : (
            <p className="text-center text-gray-600 py-16">Create a session to get started.</p>
          )}
        </div>
      </div>
    </div>
  );
}
