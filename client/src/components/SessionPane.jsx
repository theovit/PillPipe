import { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../utils/api';
import PhaseEditor from './PhaseEditor';
import ShortfallAlert from './ShortfallAlert';
import AdherenceCalendar from './AdherenceCalendar';
import { formatDate } from '../utils/prefs';
import { activePhase, phaseNotation, todayInTz, totalLabel } from '../utils/dosing';

const inputCls = 'w-full rounded bg-gray-800 border border-gray-700 px-3 py-2.5 sm:py-1.5 text-base sm:text-sm text-gray-200 focus:outline-none focus:border-violet-500';

export default function SessionPane({ session, supplements, prefs }) {
  const [regimens, setRegimens] = useState([]);
  const [phases, setPhases] = useState({});
  const [calcResults, setCalcResults] = useState({});
  const [regimenNotes, setRegimenNotes] = useState({});
  const [todayLogs, setTodayLogs] = useState({});
  const [expandedRegimen, setExpandedRegimen] = useState(null);
  const [addingRegimen, setAddingRegimen] = useState(false);
  const [regimenForm, setRegimenForm] = useState({ supplement_id: '' });
  const [calcError, setCalcError] = useState('');
  const [showShoppingList, setShowShoppingList] = useState(false);
  const [copied, setCopied] = useState(false);
  const today = todayInTz(prefs.timezone);

  async function loadRegimens() {
    const data = await api.getRegimens(session.id);
    setRegimens(data);
    const phasesMap = {};
    const notesMap = {};
    for (const r of data) {
      phasesMap[r.id] = await api.getPhases(r.id);
      notesMap[r.id] = r.notes || '';
    }
    setPhases(phasesMap);
    setRegimenNotes(notesMap);
    await loadTodayLogs();
  }

  async function loadTodayLogs() {
    try {
      const entries = await api.getDoseLog({ since: today });
      const logsMap = {};
      for (const e of entries) if (e.date.slice(0, 10) === today) logsMap[e.regimen_id] = e.status;
      setTodayLogs(logsMap);
    } catch { /* non-critical */ }
  }

  async function loadPhases(regimenId) {
    const data = await api.getPhases(regimenId);
    setPhases(p => ({ ...p, [regimenId]: data }));
  }

  async function createRegimen(e) {
    e.preventDefault();
    await api.createRegimen(session.id, { supplement_id: regimenForm.supplement_id });
    setRegimenForm({ supplement_id: '' });
    setAddingRegimen(false);
    loadRegimens();
  }

  async function deleteRegimen(id) {
    if (!window.confirm('Remove this regimen and all its phases?')) return;
    await api.deleteRegimen(id);
    loadRegimens();
  }

  async function runCalculate() {
    const missing = regimens.filter(r => !r.as_needed && !phases[r.id]?.length);
    if (missing.length) {
      setCalcError(`Add at least one phase to: ${missing.map(r => r.supplement_name).join(', ')}`);
      return;
    }
    setCalcError('');
    const { results } = await api.calculate(session.id);
    const map = {};
    for (const r of results) map[r.regimen_id] = r;
    setCalcResults(map);
  }

  async function logTodayDose(regimenId, status) {
    setTodayLogs(p => ({ ...p, [regimenId]: status }));
    await api.logDose({ regimen_id: regimenId, date: today, status }).catch(console.error);
  }

  async function logAllToday(status) {
    const scheduled = regimens.filter(r => !r.as_needed);
    const updated = {};
    for (const r of scheduled) updated[r.id] = status;
    setTodayLogs(p => ({ ...p, ...updated }));
    await Promise.all(scheduled.map(r =>
      api.logDose({ regimen_id: r.id, date: today, status }).catch(console.error)
    ));
  }

  async function saveRegimenNotes(id) {
    await api.updateRegimen(id, { notes: regimenNotes[id] || null });
    setRegimens(prev => prev.map(r => r.id === id ? { ...r, notes: regimenNotes[id] || null } : r));
  }

  async function setAsNeeded(id, value) {
    const updated = await api.updateRegimen(id, { as_needed: value });
    setRegimens(prev => prev.map(r => (r.id === id ? { ...r, as_needed: updated.as_needed } : r)));
    // As-needed regimens are excluded from the shortfall math, so drop any stale result for this one.
    setCalcResults(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
  }

  // The regimen's schedule for today: the active phase (or the first one when nothing is active).
  function scheduleInfo(r) {
    const ps = phases[r.id];
    if (!ps?.length) return null;
    const active = activePhase(ps, session.start_date.slice(0, 10), today, sessionTotalDays);
    const phase = active ? active.phase : [...ps].sort((a, b) => a.sequence_order - b.sequence_order)[0];
    const unit = r.unit || 'capsules';
    return { notation: phaseNotation(phase), total: totalLabel(phase, unit), active: !!active };
  }

  function scheduleText(r) {
    const s = scheduleInfo(r);
    return s ? `${s.notation} · ${s.total}` : '';
  }

  function phaseSummary(ps) {
    if (!ps?.length) return 'No phases';
    const defined = ps.filter(p => !p.indefinite).reduce((s, p) => s + p.duration_days, 0);
    const hasIndef = ps.some(p => p.indefinite);
    return `${ps.length} phase${ps.length !== 1 ? 's' : ''} · ${defined}d${hasIndef ? ' + ∞' : ''}`;
  }

  function downloadCSV() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const sessionStart  = formatDate(session.start_date, prefs.dateFormat);
    const sessionTarget = formatDate(session.target_date, prefs.dateFormat);
    const lines = [
      `PillPipe Shortfall Export`,
      `${esc('Session')},${esc(`${sessionStart} → ${sessionTarget} (${sessionTotalDays} days)`)}`,
      `${esc('Generated')},${esc(formatDate(today, prefs.dateFormat))}`,
      '',
      'Supplement,Brand,Unit,Schedule,"On Hand","Total Needed",Shortfall,"Bottles to Buy","Est. Cost","Days Short",Status',
    ];
    for (const r of regimens) {
      const res = calcResults[r.id];
      if (!res) continue;
      const u = r.unit || 'capsules';
      const unitLabel = u === 'ml' ? 'ml' : u === 'drops' ? 'drops' : u === 'tablets' ? 'tabs' : 'caps';
      lines.push([
        esc(r.supplement_name), esc(r.brand || ''), unitLabel, esc(scheduleText(r)),
        Number(res.currentOnHand), Number(res.pillsNeeded), Number(res.shortfall),
        Number(res.bottlesNeeded), `$${(res.estimatedCost || 0).toFixed(2)}`,
        Number(res.daysShort), res.status,
      ].join(','));
    }
    const tc = Object.values(calcResults).reduce((s, r) => s + (r.estimatedCost || 0), 0);
    lines.push('');
    lines.push(`,,,,,,,,$${tc.toFixed(2)},,Total Est. Cost`);
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `pillpipe-shortfall-${session.target_date.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Load regimens whenever the session changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRegimens();
  }, [session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The service worker logs Taken/Skip taps itself (so it works with the app closed) and then tells
  // open panes to refresh today's log.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event) => { if (event.data?.type === 'DOSE_LOGGED') loadTodayLogs(); };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps

  function downloadPDF() {
    const doc = new jsPDF();
    const sessionStart  = formatDate(session.start_date, prefs.dateFormat);
    const sessionTarget = formatDate(session.target_date, prefs.dateFormat);

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('PillPipe — Shortfall Report', 14, 20);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(`Session: ${sessionStart} → ${sessionTarget} (${sessionTotalDays} days)`, 14, 29);
    doc.text(`Generated: ${formatDate(today, prefs.dateFormat)}`, 14, 35);

    const rows = regimens.map(r => {
      const res = calcResults[r.id];
      if (!res) return null;
      const u = r.unit || 'capsules';
      const ul = u === 'ml' ? 'ml' : u === 'drops' ? 'drops' : u === 'tablets' ? 'tabs' : 'caps';
      return [
        r.supplement_name,
        r.brand || '—',
        scheduleText(r) || '—',
        `${Number(res.currentOnHand)} ${ul}`,
        `${Number(res.pillsNeeded)} ${ul}`,
        res.shortfall > 0 ? `${Number(res.shortfall)} ${ul}` : '—',
        res.bottlesNeeded > 0 ? String(Number(res.bottlesNeeded)) : '—',
        `$${(res.estimatedCost || 0).toFixed(2)}`,
        res.status,
      ];
    }).filter(Boolean);

    const tc = Object.values(calcResults).reduce((s, r) => s + (r.estimatedCost || 0), 0);

    autoTable(doc, {
      startY: 42,
      head: [['Supplement', 'Brand', 'Schedule', 'On Hand', 'Needed', 'Shortfall', 'Bottles', 'Est. Cost', 'Status']],
      body: rows,
      foot: [['', '', '', '', '', '', '', `$${tc.toFixed(2)}`, 'Total']],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [109, 40, 217], textColor: 255 },
      footStyles: { fillColor: [243, 244, 246], textColor: [50, 50, 50], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
    });

    doc.save(`pillpipe-shortfall-${session.target_date.slice(0, 10)}.pdf`);
  }

  function copyShoppingList() {
    const items = regimens
      .map(r => ({ r, res: calcResults[r.id] }))
      .filter(({ res }) => res && res.bottlesNeeded > 0);
    const lines = [
      `Shopping List — ${formatDate(session.target_date, prefs.dateFormat)}`,
      `Generated ${formatDate(today, prefs.dateFormat)}`,
      '',
      ...items.map(({ r, res }) => {
        const name = r.brand ? `${r.supplement_name} (${r.brand})` : r.supplement_name;
        return `• ${name} — ${res.bottlesNeeded} bottle${res.bottlesNeeded !== 1 ? 's' : ''} — $${(res.estimatedCost || 0).toFixed(2)}`;
      }),
      '',
      `Total: $${items.reduce((s, { res }) => s + (res.estimatedCost || 0), 0).toFixed(2)}`,
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const totalCost = Object.keys(calcResults).length > 0
    ? Object.values(calcResults).reduce((sum, r) => sum + (r.estimatedCost || 0), 0)
    : null;

  const sessionTotalDays = Math.ceil(
    (new Date(session.target_date) - new Date(session.start_date)) / (1000 * 60 * 60 * 24)
  );

  const daysLeft = Math.ceil(
    (new Date(session.target_date) - new Date()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Regimens — {formatDate(session.target_date, prefs.dateFormat)}
            {daysLeft >= 0
              ? <span className="ml-2 text-violet-400 font-normal normal-case font-mono">· {daysLeft}d left</span>
              : <span className="ml-2 text-red-400 font-normal normal-case font-mono">· {Math.abs(daysLeft)}d overdue</span>
            }
          </h2>
          {totalCost !== null && (
            <p className="text-xs text-gray-500 mt-0.5">
              Total to buy: <span className="text-violet-300 font-medium font-mono">${totalCost.toFixed(2)}</span>
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0 items-center">
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
      {totalCost !== null && (
        <div className="flex gap-2 flex-wrap mt-2">
          <button onClick={downloadCSV}
            className="px-4 py-3 sm:py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium"
            title="Export results as CSV">
            ↓ CSV
          </button>
          <button onClick={downloadPDF}
            className="px-4 py-3 sm:py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium"
            title="Export results as PDF">
            ↓ PDF
          </button>
          {regimens.some(r => calcResults[r.id]?.bottlesNeeded > 0) && (
            <button onClick={() => setShowShoppingList(true)}
              className="px-4 py-3 sm:py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium"
              title="View shopping list">
              🛒 List
            </button>
          )}
        </div>
      )}

      {calcError && (
        <p className="mt-2 text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">{calcError}</p>
      )}

      {/* Add regimen form */}
      {addingRegimen && (
        <form onSubmit={createRegimen} className="rounded-xl bg-gray-800/50 border border-gray-700 p-4 flex gap-3 items-end mt-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Supplement</label>
            <select required value={regimenForm.supplement_id}
              onChange={e => setRegimenForm(f => ({ ...f, supplement_id: e.target.value }))}
              className={inputCls}>
              <option value="">Select…</option>
              {supplements.map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.brand ? ` (${s.brand})` : ''} — {s.current_inventory} {s.unit === 'ml' ? 'ml' : s.unit === 'drops' ? 'drops' : s.unit === 'tablets' ? 'tabs' : 'caps'} on hand</option>
              ))}
            </select>
          </div>
          <button type="submit" className="px-4 py-2.5 sm:py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium shrink-0">
            Add
          </button>
        </form>
      )}

      {/* Bulk log bar */}
      {regimens.some(r => !r.as_needed) && (
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-gray-600 shrink-0">Today:</span>
          <button onClick={() => logAllToday('taken')}
            className="px-3 py-1.5 rounded bg-green-800/70 hover:bg-green-700 text-green-200 text-xs font-medium">
            ✓ Mark all taken
          </button>
          <button onClick={() => logAllToday('skipped')}
            className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs font-medium">
            ✗ Skip all
          </button>
        </div>
      )}

      {/* Regimen cards */}
      <div className="space-y-3 mt-3">
        {regimens.map(r => {
          const isExpanded = expandedRegimen === r.id;
          return (
            <div key={r.id} className="rounded-xl bg-gray-800/60 border border-gray-700/60 p-4">
              <div className="cursor-pointer"
                onClick={() => setExpandedRegimen(isExpanded ? null : r.id)}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-white">
                    {r.supplement_name}
                    {r.take_with_food && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium align-middle bg-amber-900/40 text-amber-400">with food</span>}
                    {r.as_needed && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium align-middle bg-blue-900/40 text-blue-400">As needed</span>}
                  </h3>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-sm text-gray-400 whitespace-nowrap mr-1">
                      <span className="font-mono">{(() => {
                        const v = calcResults[r.id] != null ? calcResults[r.id].currentOnHand : r.current_inventory;
                        const u = r.unit || 'capsules';
                        if (u === 'drops') return `${Number(v)} drops`;
                        if (u === 'ml') return `${Number(v)} ml`;
                        if (u === 'tablets') return `${Number(v)} tabs`;
                        return `${Number(v)} caps`;
                      })()}</span> on hand
                    </span>
                    <button onClick={e => { e.stopPropagation(); setExpandedRegimen(isExpanded ? null : r.id); }}
                      className={`hidden sm:block p-2 transition-colors ${isExpanded ? 'text-violet-400 hover:text-violet-300' : 'text-gray-500 hover:text-gray-300'}`}>
                      ✎
                    </button>
                    <button onClick={e => { e.stopPropagation(); deleteRegimen(r.id); }} className="hidden sm:block text-red-500 hover:text-red-400 p-2">✕</button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {r.brand && <><span className="whitespace-nowrap">{r.brand}</span>{' · '}</>}
                  <span className="whitespace-nowrap">{r.unit === 'drops' ? `${r.pills_per_bottle} ml/bottle` : r.unit === 'ml' ? `${r.pills_per_bottle} ml/bottle` : `${r.pills_per_bottle} ${r.unit === 'tablets' ? 'tabs' : 'caps'}/bottle`}</span>
                  {' · '}<span className="whitespace-nowrap">${Number(r.price).toFixed(2)}</span>
                </p>
              </div>

              {/* Collapsed: phase summary + notes preview + quick log */}
              {!isExpanded && (
                <div className="mt-2 space-y-1.5">
                  {r.as_needed ? (
                    <p className="text-xs text-gray-500">As needed — no schedule, reminders or shortfall tracking</p>
                  ) : (
                    <div className="text-xs space-y-0.5">
                      {scheduleInfo(r) && (
                        <p className="text-gray-300">
                          <span className="font-mono">{scheduleInfo(r).notation}</span>
                          <span className="text-gray-500"> · {scheduleInfo(r).total}</span>
                          {!scheduleInfo(r).active && <span className="text-gray-600"> · not active today</span>}
                        </p>
                      )}
                      <p className="text-gray-600">{phaseSummary(phases[r.id])}</p>
                    </div>
                  )}
                  {r.notes && <p className="text-xs text-gray-500 italic line-clamp-1">{r.notes}</p>}
                  {!r.as_needed && <div className="flex items-center gap-2 pt-0.5" onClick={e => e.stopPropagation()}>
                    {!todayLogs[r.id] ? (
                      <>
                        <button onClick={() => logTodayDose(r.id, 'taken')}
                          className="px-2.5 py-1 rounded bg-green-800/70 hover:bg-green-700 text-green-200 text-xs font-medium">
                          ✓ Taken
                        </button>
                        <button onClick={() => logTodayDose(r.id, 'skipped')}
                          className="px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs font-medium">
                          ✗ Skip
                        </button>
                      </>
                    ) : (
                      <>
                        <span className={`text-xs font-medium ${todayLogs[r.id] === 'taken' ? 'text-green-400' : 'text-gray-400'}`}>
                          {todayLogs[r.id] === 'taken' ? '✓ Taken today' : '✗ Skipped today'}
                        </span>
                        <button onClick={() => logTodayDose(r.id, todayLogs[r.id] === 'taken' ? 'skipped' : 'taken')}
                          className="text-xs text-gray-600 hover:text-gray-400">
                          change
                        </button>
                      </>
                    )}
                  </div>}
                </div>
              )}

              {/* Expanded: notes + phase editor + adherence */}
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
                  <label className="flex items-start gap-2 text-sm text-gray-400 cursor-pointer select-none">
                    <input type="checkbox" checked={!!r.as_needed} onChange={e => setAsNeeded(r.id, e.target.checked)}
                      className="accent-violet-500 w-4 h-4 mt-0.5" />
                    <span>As needed <span className="text-gray-600 text-xs">— no schedule, reminders or shortfall math; manage its inventory by hand</span></span>
                  </label>
                  {!r.as_needed && (<>
                  <PhaseEditor
                    regimenId={r.id}
                    phases={phases[r.id] || []}
                    onUpdate={() => loadPhases(r.id)}
                    sessionTotalDays={sessionTotalDays}
                    unit={r.unit || 'capsules'}
                  />
                  <div className="border-t border-gray-700 pt-3">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">Adherence</p>
                    <AdherenceCalendar
                      regimenId={r.id}
                      sessionStartDate={session.start_date}
                      todayStatus={todayLogs[r.id] ?? null}
                      onLogToday={(status) => logTodayDose(r.id, status)}
                    />
                  </div>
                  </>)}
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
                  <ShortfallAlert
                    result={calcResults[r.id]}
                    unit={calcResults[r.id]?.unit || r.unit || 'capsules'}
                    drops_per_ml={calcResults[r.id]?.drops_per_ml || r.drops_per_ml || 20}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {regimens.length === 0 && (
        <p className="text-center text-gray-600 py-8">No regimens yet. Use + Add above.</p>
      )}

      {/* Shopping List Modal */}
      {showShoppingList && (() => {
        const items = regimens
          .map(r => ({ r, res: calcResults[r.id] }))
          .filter(({ res }) => res && res.bottlesNeeded > 0);
        const listTotal = items.reduce((s, { res }) => s + (res.estimatedCost || 0), 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setShowShoppingList(false)}>
            <div className="w-full max-w-sm rounded-xl bg-gray-900 border border-gray-700 p-5 shadow-xl"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Shopping List</h3>
                <button onClick={() => setShowShoppingList(false)}
                  className="text-gray-600 hover:text-gray-400 p-1">✕</button>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                {formatDate(session.target_date, prefs.dateFormat)} · {items.length} item{items.length !== 1 ? 's' : ''}
              </p>
              <ul className="space-y-2 mb-4">
                {items.map(({ r, res }) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-200 truncate">{r.supplement_name}</p>
                      {r.brand && <p className="text-xs text-gray-500 truncate">{r.brand}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm text-gray-200 font-mono">{res.bottlesNeeded} × bottle</p>
                      <p className="text-xs text-violet-400 font-mono">${(res.estimatedCost || 0).toFixed(2)}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="border-t border-gray-700 pt-3 flex items-center justify-between mb-4">
                <span className="text-sm text-gray-400">Total</span>
                <span className="text-sm font-semibold text-violet-300 font-mono">${listTotal.toFixed(2)}</span>
              </div>
              <button onClick={copyShoppingList}
                className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
                {copied ? '✓ Copied!' : 'Copy to Clipboard'}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
