import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import PhaseEditor from './PhaseEditor';
import ShortfallAlert from './ShortfallAlert';
import SupplementsPanel from './SupplementsPanel';

const today = new Date().toISOString().slice(0, 10);
const inputCls = 'w-full rounded bg-gray-800 border border-gray-700 px-3 py-2.5 sm:py-1.5 text-base sm:text-sm text-gray-200 focus:outline-none focus:border-violet-500';

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
  const [addingSession, setAddingSession] = useState(false);
  const [showOtherSessions, setShowOtherSessions] = useState(false);
  const [addingRegimen, setAddingRegimen] = useState(false);
  const [expandedRegimen, setExpandedRegimen] = useState(null);
  const [regimenNotes, setRegimenNotes] = useState({});
  const [calcError, setCalcError] = useState('');
  const [openSections, setOpenSections] = useState({});
  function toggleSection(name) { setOpenSections(p => ({ ...p, [name]: !p[name] })); }

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
    const notesMap = {};
    for (const r of data) {
      phasesMap[r.id] = await api.getPhases(r.id);
      notesMap[r.id] = r.notes || '';
    }
    setPhases(phasesMap);
    setRegimenNotes(notesMap);
  }

  async function saveRegimenNotes(id) {
    await api.updateRegimen(id, { notes: regimenNotes[id] || null });
    setRegimens(prev => prev.map(r => r.id === id ? { ...r, notes: regimenNotes[id] || null } : r));
  }

  async function loadPhases(regimenId) {
    const data = await api.getPhases(regimenId);
    setPhases(p => ({ ...p, [regimenId]: data }));
  }

  async function createSession(e) {
    e.preventDefault();
    if (sessionForm.target_date <= sessionForm.start_date) {
      alert('Target date must be after the start date.');
      return;
    }
    const s = await api.createSession(sessionForm);
    setSessionForm({ start_date: today, target_date: '', notes: '' });
    setSessions(prev => [s, ...prev]);
    setActiveSession(s);
    setAddingSession(false);
  }

  async function createRegimen(e) {
    e.preventDefault();
    await api.createRegimen(activeSession.id, { supplement_id: regimenForm.supplement_id });
    setRegimenForm({ supplement_id: '' });
    setAddingRegimen(false);
    loadRegimens();
  }

  function phaseSummary(ps) {
    if (!ps?.length) return 'No phases';
    const defined = ps.filter(p => !p.indefinite).reduce((s, p) => s + p.duration_days, 0);
    const hasIndef = ps.some(p => p.indefinite);
    return `${ps.length} phase${ps.length !== 1 ? 's' : ''} · ${defined}d${hasIndef ? ' + ∞' : ''}`;
  }

  async function runCalculate() {
    const missing = regimens.filter(r => !phases[r.id]?.length);
    if (missing.length) {
      setCalcError(`Add at least one phase to: ${missing.map(r => r.supplement_name).join(', ')}`);
      return;
    }
    setCalcError('');
    const { results } = await api.calculate(activeSession.id);
    const map = {};
    for (const r of results) map[r.regimen_id] = r;
    setCalcResults(map);
  }

  async function saveSession(e) {
    e.preventDefault();
    if (editingSession.target_date <= editingSession.start_date) {
      alert('Target date must be after the start date.');
      return;
    }
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
    if (!window.confirm('Delete this session and all its regimens?')) return;
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
    if (!window.confirm('Remove this regimen and all its phases?')) return;
    await api.deleteRegimen(id);
    loadRegimens();
  }

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

  async function downloadBackup() {
    const data = await api.getBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pillpipe-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function restoreBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.confirm('This will replace ALL your data with the backup. Are you sure?')) {
      e.target.value = '';
      return;
    }
    const text = await file.text();
    await api.restore(JSON.parse(text));
    setView('regimens');
    await loadSupplements();
    await loadSessions();
    e.target.value = '';
  }

  async function clearAllData() {
    if (!window.confirm('This will permanently delete ALL sessions, regimens, and supplements. This cannot be undone.')) return;
    if (!window.confirm('Are you absolutely sure? All data will be gone.')) return;
    await api.clearData();
    setView('regimens');
    setActiveSession(null);
    setSessions([]);
    setRegimens([]);
    setPhases({});
    setCalcResults({});
    await loadSupplements();
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 p-3 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 sm:mb-8 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">PillPipe</h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-0.5">Supplement inventory & shortfall tracking</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
            <button onClick={() => setView('regimens')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${view === 'regimens' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              Regimens
            </button>
            <button onClick={() => setView('supplements')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${view === 'supplements' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              Supplements
            </button>
            <button onClick={() => setView('settings')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${view === 'settings' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              ⚙
            </button>
          </div>
        </div>
      </div>

      {/* Settings page */}
      {view === 'settings' && (
        <div className="max-w-lg space-y-3">
          {/* Data */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
            <button onClick={() => toggleSection('data')}
              className="w-full flex items-center justify-between px-5 py-4 text-left">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Data</h2>
              <span className="text-gray-600 text-xs">{openSections.data ? '▲' : '▼'}</span>
            </button>
            {openSections.data && (
              <div className="px-5 pb-4 space-y-3 border-t border-gray-800 pt-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-200 font-medium">Download Backup</p>
                    <p className="text-xs text-gray-500 mt-0.5">Export all data to a JSON file.</p>
                  </div>
                  <button onClick={downloadBackup}
                    className="shrink-0 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
                    Export
                  </button>
                </div>
                <div className="border-t border-gray-800 pt-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-200 font-medium">Restore from Backup</p>
                    <p className="text-xs text-amber-500 mt-0.5">Replaces all current data.</p>
                  </div>
                  <label className="shrink-0 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium cursor-pointer">
                    Import
                    <input type="file" accept=".json" className="hidden" onChange={restoreBackup} />
                  </label>
                </div>
                <div className="border-t border-gray-800 pt-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-gray-200 font-medium">Clear All Data</p>
                    <p className="text-xs text-red-500 mt-0.5">Permanently deletes everything.</p>
                  </div>
                  <button onClick={clearAllData}
                    className="shrink-0 px-4 py-2 rounded-lg border border-red-900 text-red-400 hover:bg-red-900/20 text-sm font-medium">
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Appearance — coming soon */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden opacity-50">
            <button onClick={() => toggleSection('appearance')}
              className="w-full flex items-center justify-between px-5 py-4 text-left cursor-not-allowed">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Appearance</h2>
              <span className="text-gray-600 text-xs">{openSections.appearance ? '▲' : '▼'}</span>
            </button>
            {openSections.appearance && (
              <p className="px-5 pb-4 text-xs text-gray-600 border-t border-gray-800 pt-3">Font size, theme color — coming soon.</p>
            )}
          </div>

          {/* Preferences — coming soon */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden opacity-50">
            <button onClick={() => toggleSection('preferences')}
              className="w-full flex items-center justify-between px-5 py-4 text-left cursor-not-allowed">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Preferences</h2>
              <span className="text-gray-600 text-xs">{openSections.preferences ? '▲' : '▼'}</span>
            </button>
            {openSections.preferences && (
              <p className="px-5 pb-4 text-xs text-gray-600 border-t border-gray-800 pt-3">Date format, default session duration — coming soon.</p>
            )}
          </div>
        </div>
      )}

      <div className={`grid grid-cols-1 gap-4 sm:gap-6 ${view === 'supplements' ? '' : 'lg:grid-cols-3'} ${view === 'settings' ? 'hidden' : ''}`}>
        {/* Sidebar: Sessions */}
        {view !== 'supplements' && <div className="lg:col-span-1 space-y-4">
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Session</h2>
              <button onClick={() => { setAddingSession(a => !a); setEditingSession(null); }}
                className="text-sm text-violet-400 hover:text-violet-300 font-medium">
                {addingSession ? 'Cancel' : '+ New'}
              </button>
            </div>

            {/* New session form */}
            {addingSession && (
              <form onSubmit={createSession} className="space-y-2.5 mb-4">
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
                <button type="submit" className="w-full py-2.5 sm:py-2 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
                  Create Session
                </button>
              </form>
            )}

            {/* Active session */}
            {activeSession && !addingSession && (
              <div>
                {editingSession?.id === activeSession.id ? (
                  <form onSubmit={saveSession} className="space-y-1.5">
                    <input type="date" required value={editingSession.start_date}
                      onChange={e => setEditingSession(f => ({ ...f, start_date: e.target.value }))}
                      className={inputCls} />
                    <input type="date" required value={editingSession.target_date}
                      onChange={e => setEditingSession(f => ({ ...f, target_date: e.target.value }))}
                      className={inputCls} />
                    <textarea rows={2} value={editingSession.notes || ''}
                      onChange={e => setEditingSession(f => ({ ...f, notes: e.target.value }))}
                      className={`${inputCls} resize-none`}
                      placeholder="Notes" />
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <button type="submit" className="px-3 py-2.5 sm:py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm">Save</button>
                      <button type="button" onClick={() => setEditingSession(null)} className="px-3 py-2.5 sm:py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
                      <button type="button" className="sm:hidden px-3 py-2.5 rounded text-gray-400 hover:text-gray-200 text-sm"
                        onClick={() => { setEditingSession(null); setCopyingSession(activeSession.id); setCopyForm({ start_date: today, target_date: '' }); }}>Copy</button>
                      <button type="button" className="sm:hidden px-3 py-2.5 rounded text-red-400 hover:text-red-300 text-sm ml-auto"
                        onClick={() => { setEditingSession(null); deleteSession(activeSession.id); }}>Delete</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="rounded-lg bg-violet-700/20 border border-violet-600/30 px-3 py-3 cursor-pointer"
                      onClick={() => setEditingSession({ ...activeSession, start_date: activeSession.start_date.slice(0, 10), target_date: activeSession.target_date.slice(0, 10), notes: activeSession.notes || '' })}>
                      <div className="flex items-start gap-1">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-violet-300 flex items-center gap-2 flex-wrap text-sm">
                            → {new Date(activeSession.target_date).toLocaleDateString()}
                            {daysLeftBadge(activeSession.target_date)}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">from {new Date(activeSession.start_date).toLocaleDateString()}</div>
                          {activeSession.notes && <div className="text-xs text-gray-400 mt-1.5 leading-relaxed">{activeSession.notes}</div>}
                        </div>
                        <button onClick={e => { e.stopPropagation(); setCopyingSession(activeSession.id); setCopyForm({ start_date: today, target_date: '' }); }}
                          className="hidden sm:block text-gray-500 hover:text-gray-300 p-2 shrink-0" title="Copy to new session">⧉</button>
                        <button onClick={e => { e.stopPropagation(); setEditingSession({ ...activeSession, start_date: activeSession.start_date.slice(0, 10), target_date: activeSession.target_date.slice(0, 10), notes: activeSession.notes || '' }); }}
                          className="hidden sm:block text-gray-500 hover:text-gray-300 p-2 shrink-0">✎</button>
                        <button onClick={e => { e.stopPropagation(); deleteSession(activeSession.id); }}
                          className="hidden sm:block text-red-500 hover:text-red-400 p-2 shrink-0">✕</button>
                      </div>
                    </div>
                    {copyingSession === activeSession.id && (
                      <form onSubmit={submitCopySession} className="mt-2 space-y-1.5 pt-2">
                        <p className="text-xs text-gray-400 font-medium">Copy to new session</p>
                        <input type="date" required value={copyForm.start_date}
                          onChange={e => setCopyForm(f => ({ ...f, start_date: e.target.value }))}
                          className={inputCls} />
                        <input type="date" required value={copyForm.target_date}
                          onChange={e => setCopyForm(f => ({ ...f, target_date: e.target.value }))}
                          className={inputCls} />
                        <div className="flex gap-2 pt-0.5">
                          <button type="submit" className="px-3 py-2 sm:py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm">Copy</button>
                          <button type="button" onClick={() => setCopyingSession(null)} className="px-3 py-2 sm:py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
                        </div>
                      </form>
                    )}
                  </>
                )}
              </div>
            )}

            {!activeSession && !addingSession && (
              <p className="text-xs text-gray-600 text-center py-2">No sessions yet.</p>
            )}

            {/* Other sessions */}
            {sessions.length > 1 && !addingSession && (
              <div className="mt-3">
                <button onClick={() => setShowOtherSessions(s => !s)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  <span>{showOtherSessions ? '▾' : '▸'}</span>
                  <span>{sessions.length - 1} other session{sessions.length - 1 !== 1 ? 's' : ''}</span>
                </button>
                {showOtherSessions && (
                  <div className="mt-2 space-y-1">
                    {sessions.filter(s => s.id !== activeSession?.id).map(s => (
                      <div key={s.id}>
                        <div className="rounded px-3 py-2.5 text-sm hover:bg-gray-800 text-gray-400 transition-colors">
                          {editingSession?.id === s.id ? (
                            <form onSubmit={saveSession} className="space-y-1.5">
                              <input type="date" required value={editingSession.start_date}
                                onChange={e => setEditingSession(f => ({ ...f, start_date: e.target.value }))}
                                className={inputCls} />
                              <input type="date" required value={editingSession.target_date}
                                onChange={e => setEditingSession(f => ({ ...f, target_date: e.target.value }))}
                                className={inputCls} />
                              <textarea rows={2} value={editingSession.notes || ''}
                                onChange={e => setEditingSession(f => ({ ...f, notes: e.target.value }))}
                                className={`${inputCls} resize-none`}
                                placeholder="Notes" />
                              <div className="flex gap-2 pt-0.5">
                                <button type="submit" className="px-3 py-2 sm:py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm">Save</button>
                                <button type="button" onClick={() => setEditingSession(null)} className="px-3 py-2 sm:py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
                              </div>
                            </form>
                          ) : (
                            <div className="flex items-start gap-1">
                              <button className="flex-1 text-left py-1" onClick={() => { setActiveSession(s); setCalcResults({}); setShowOtherSessions(false); }}>
                                <div className="font-medium flex items-center gap-2 flex-wrap">
                                  → {new Date(s.target_date).toLocaleDateString()}
                                  {daysLeftBadge(s.target_date)}
                                </div>
                                <div className="text-xs opacity-60">from {new Date(s.start_date).toLocaleDateString()}</div>
                                {s.notes && <div className="text-xs opacity-50 mt-0.5 line-clamp-1">{s.notes}</div>}
                              </button>
                              <button onClick={() => { setCopyingSession(s.id); setCopyForm({ start_date: today, target_date: '' }); }}
                                className="hidden sm:block text-gray-500 hover:text-gray-300 p-2 shrink-0" title="Copy to new session">⧉</button>
                              <button onClick={() => setEditingSession({ ...s, start_date: s.start_date.slice(0, 10), target_date: s.target_date.slice(0, 10), notes: s.notes || '' })}
                                className="hidden sm:block text-gray-500 hover:text-gray-300 p-2 shrink-0">✎</button>
                              <button onClick={() => deleteSession(s.id)}
                                className="hidden sm:block text-red-500 hover:text-red-400 p-2 shrink-0">✕</button>
                            </div>
                          )}
                        </div>
                        {copyingSession === s.id && (
                          <form onSubmit={submitCopySession} className="mt-1 space-y-1.5 px-3 py-3 bg-gray-800/50 rounded border border-gray-700">
                            <p className="text-xs text-gray-400 font-medium">Copy to new session</p>
                            <input type="date" required value={copyForm.start_date}
                              onChange={e => setCopyForm(f => ({ ...f, start_date: e.target.value }))}
                              className={inputCls} />
                            <input type="date" required value={copyForm.target_date}
                              onChange={e => setCopyForm(f => ({ ...f, target_date: e.target.value }))}
                              className={inputCls} />
                            <div className="flex gap-2 pt-0.5">
                              <button type="submit" className="px-3 py-2 sm:py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm">Copy</button>
                              <button type="button" onClick={() => setCopyingSession(null)} className="px-3 py-2 sm:py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
                            </div>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>}

        {/* Main panel */}
        <div className={view === 'supplements' ? 'col-span-full' : 'lg:col-span-2'} style={{minWidth: 0}}>
          {view === 'supplements' ? (
            <SupplementsPanel supplements={supplements} onUpdate={loadSupplements} />
          ) : activeSession ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                    Regimens — {new Date(activeSession.target_date).toLocaleDateString()}
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
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => { setAddingRegimen(a => !a); setCalcError(''); }}
                    className="px-4 py-3 sm:py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium">
                    {addingRegimen ? 'Cancel' : '+ Add'}
                  </button>
                  <button onClick={runCalculate}
                    className="px-5 py-3 sm:py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
                    Calculate
                  </button>
                </div>
              </div>

              {calcError && (
                <p className="mt-2 text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">{calcError}</p>
              )}

              {/* Add regimen form */}
              {addingRegimen && (
                <form onSubmit={createRegimen} className="rounded-xl bg-gray-900 border border-gray-800 p-5 flex gap-3 items-end mt-4">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Supplement</label>
                    <select required value={regimenForm.supplement_id}
                      onChange={e => setRegimenForm(f => ({ ...f, supplement_id: e.target.value }))}
                      className={inputCls}>
                      <option value="">Select…</option>
                      {supplements.map(s => (
                        <option key={s.id} value={s.id}>{s.name}{s.brand ? ` (${s.brand})` : ''} — {s.current_inventory} on hand</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="px-4 py-2.5 sm:py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium shrink-0">
                    Add
                  </button>
                </form>
              )}

              {/* Regimen cards */}
              <div className="space-y-3 mt-4">
                {regimens.map(r => {
                  const isExpanded = expandedRegimen === r.id;
                  return (
                    <div key={r.id} className="rounded-xl bg-gray-900 border border-gray-800 p-5">
                      <div className="flex items-start justify-between gap-3 cursor-pointer"
                        onClick={() => setExpandedRegimen(isExpanded ? null : r.id)}>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-white">{r.supplement_name}</h3>
                          <p className="text-xs text-gray-500 truncate">{r.brand} · {r.pills_per_bottle} pills/bottle · ${Number(r.price).toFixed(2)}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-sm text-gray-400 whitespace-nowrap mr-1">
                            {calcResults[r.id] != null ? calcResults[r.id].currentOnHand : r.current_inventory} on hand
                          </span>
                          <button onClick={e => { e.stopPropagation(); setExpandedRegimen(isExpanded ? null : r.id); }}
                            className={`hidden sm:block p-2 transition-colors ${isExpanded ? 'text-violet-400 hover:text-violet-300' : 'text-gray-500 hover:text-gray-300'}`}>
                            ✎
                          </button>
                          <button onClick={e => { e.stopPropagation(); deleteRegimen(r.id); }} className="hidden sm:block text-red-500 hover:text-red-400 p-2">✕</button>
                        </div>
                      </div>

                      {/* Collapsed: phase summary + notes preview */}
                      {!isExpanded && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs text-gray-600">{phaseSummary(phases[r.id])}</p>
                          {r.notes && <p className="text-xs text-gray-500 italic line-clamp-1">{r.notes}</p>}
                        </div>
                      )}

                      {/* Expanded: notes + full phase editor */}
                      {isExpanded && (
                        <div className="mt-4 space-y-4">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Notes <span className="text-gray-600">(optional)</span></label>
                            <textarea
                              rows={2}
                              value={regimenNotes[r.id] ?? ''}
                              onChange={e => setRegimenNotes(n => ({ ...n, [r.id]: e.target.value }))}
                              onBlur={() => saveRegimenNotes(r.id)}
                              className={`${inputCls} resize-none`}
                              placeholder="e.g. take with food, avoid at night…"
                            />
                          </div>
                          <PhaseEditor
                            regimenId={r.id}
                            phases={phases[r.id] || []}
                            onUpdate={() => loadPhases(r.id)}
                            sessionTotalDays={sessionTotalDays}
                          />
                          <div className="sm:hidden flex gap-2 pt-2 border-t border-gray-700/50">
                            <button onClick={() => setExpandedRegimen(null)}
                              className="flex-1 py-2.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium">Done</button>
                            <button onClick={() => deleteRegimen(r.id)}
                              className="px-4 py-2.5 rounded border border-red-900 text-red-400 hover:text-red-300 text-sm">Delete</button>
                          </div>
                        </div>
                      )}

                      {calcResults[r.id] && (
                        <div className="mt-3">
                          <ShortfallAlert result={calcResults[r.id]} supplementName={r.supplement_name} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {regimens.length === 0 && (
                <p className="text-center text-gray-600 py-8">No regimens yet. Use + Add above.</p>
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
