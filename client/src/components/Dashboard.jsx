import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { applyAccentColor, applyColorScheme, applyPrefs, defaultTargetDate, formatDate, loadPrefs, PRESET_COLORS, savePrefs } from '../utils/prefs';
import SessionPane from './SessionPane';
import SupplementsPanel from './SupplementsPanel';

const today = new Date().toISOString().slice(0, 10);
const inputCls = 'w-full rounded bg-gray-800 border border-gray-700 px-3 py-2.5 sm:py-1.5 text-base sm:text-sm text-gray-200 focus:outline-none focus:border-violet-500';

export default function Dashboard() {
  const [supplements, setSupplements] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [openSessionIds, setOpenSessionIds] = useState([]);
  const [sessionForm, setSessionForm] = useState({ start_date: today, target_date: '', notes: '', template_id: '' });
  const [editingSession, setEditingSession] = useState(null);
  const [copyingSession, setCopyingSession] = useState(null);
  const [copyForm, setCopyForm] = useState({ start_date: today, target_date: '' });
  const [view, setView] = useState('regimens');
  const [addingSession, setAddingSession] = useState(false);
  const [openSections, setOpenSections] = useState({});
  const [appVersion, setAppVersion] = useState('');
  const [notifStatus, setNotifStatus] = useState('idle'); // idle | requesting | granted | denied | unsupported
  const [swReg, setSwReg] = useState(null);
  const [pushSub, setPushSub] = useState(null);
  const [testResult, setTestResult] = useState(''); // '' | 'sending' | 'sent' | error string
  const [templates, setTemplates] = useState([]);
  const [savingTemplate, setSavingTemplate] = useState(null); // session id
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [driveStatus, setDriveStatus] = useState(null); // null | { connected, email, frequency, last_backup_at }
  const [driveBackups, setDriveBackups] = useState([]);
  const [driveWorking, setDriveWorking] = useState(false);
  const [driveMsg, setDriveMsg] = useState('');
  const [showDriveBackups, setShowDriveBackups] = useState(false);
  const [prefs, setPrefs] = useState(() => loadPrefs());

  function toggleSection(name) { setOpenSections(p => ({ ...p, [name]: !p[name] })); }

  function updatePref(key, value) {
    setPrefs(p => {
      const next = { ...p, [key]: value };
      savePrefs(next);
      applyPrefs(next);
      api.savePrefs(next).catch(() => {});
      return next;
    });
  }

  // When switching away from custom, clear customColor so the picker resets cleanly
  function selectPresetColor(key) {
    setPrefs(p => {
      const next = { ...p, accentColor: key };
      savePrefs(next);
      applyPrefs(next);
      api.savePrefs(next).catch(() => {});
      return next;
    });
  }

  useEffect(() => {
    // Load prefs from server on startup; server is source of truth, localStorage is the fallback
    api.getPrefs().then(serverPrefs => {
      if (serverPrefs && Object.keys(serverPrefs).length > 0) {
        const merged = { ...loadPrefs(), ...serverPrefs };
        savePrefs(merged);
        setPrefs(merged);
        applyPrefs(merged);
      } else {
        applyPrefs(prefs);
        // Seed the server with whatever is in localStorage
        api.savePrefs(prefs).catch(() => {});
      }
    }).catch(() => { applyPrefs(prefs); });
    loadSupplements();
    loadSessions();
    api.getVersion().then(d => setAppVersion(d.version)).catch(() => {});
    initServiceWorker();
    // Handle Google OAuth callback redirect
    const params = new URLSearchParams(window.location.search);
    const driveParam = params.get('drive');
    if (driveParam) {
      window.history.replaceState({}, '', window.location.pathname);
      if (driveParam === 'connected') {
        setView('settings');
        setOpenSections(s => ({ ...s, data: true }));
        setDriveMsg('✓ Google Drive connected successfully.');
        loadDriveStatus();
      } else if (driveParam === 'error') {
        setView('settings');
        setOpenSections(s => ({ ...s, data: true }));
        setDriveMsg('Google Drive connection failed. Please try again.');
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-apply color scheme when system preference changes (only relevant in 'system' mode)
  useEffect(() => {
    if (prefs.colorScheme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { applyColorScheme('system'); applyAccentColor(prefs.accentColor, prefs.customColor); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [prefs.colorScheme, prefs.accentColor, prefs.customColor]);

  async function initServiceWorker() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      // PushManager is blocked on HTTP (non-localhost) — distinguish from truly unsupported
      const isHttp = location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
      setNotifStatus(isHttp ? 'needs-https' : 'unsupported');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      setSwReg(reg);
      const existing = await reg.pushManager.getSubscription();
      if (existing) { setPushSub(existing); setNotifStatus('granted'); }
      else if (Notification.permission === 'denied') setNotifStatus('denied');
      else setNotifStatus('idle');
    } catch { setNotifStatus('unsupported'); }
  }

  async function enableNotifications() {
    if (!swReg) return;
    setNotifStatus('requesting');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setNotifStatus('denied'); return; }
      const { publicKey } = await api.getVapidKey();
      const sub = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.pushSubscribe(sub.toJSON());
      setPushSub(sub);
      setNotifStatus('granted');
    } catch (e) { console.error(e); setNotifStatus('idle'); }
  }

  async function disableNotifications() {
    if (!pushSub) return;
    await pushSub.unsubscribe();
    await api.pushUnsubscribe(pushSub.endpoint).catch(() => {});
    setPushSub(null);
    setNotifStatus('idle');
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  async function loadSupplements() {
    setSupplements(await api.getSupplements());
  }

  async function loadTemplates() {
    try { setTemplates(await api.getTemplates()); } catch { /* non-critical */ }
  }

  async function loadDriveStatus() {
    try { setDriveStatus(await api.getDriveStatus()); } catch { /* non-critical */ }
  }

  async function loadDriveBackups() {
    try { setDriveBackups((await api.getDriveBackups()).files); } catch { setDriveBackups([]); }
  }

  async function driveBackupNow() {
    setDriveWorking(true); setDriveMsg('');
    try {
      const r = await api.driveBackupNow();
      setDriveMsg(`✓ Backed up: ${r.file.name}`);
      await loadDriveStatus();
    } catch (e) { setDriveMsg(`Backup failed: ${e.message}`); }
    finally { setDriveWorking(false); }
  }

  async function driveRestoreFile(fileId, filename) {
    if (!confirm(`Restore from "${filename}"? This will replace all current data.`)) return;
    setDriveWorking(true); setDriveMsg('');
    try {
      const result = await api.restoreFromDrive(fileId);
      // Apply client-side prefs from the backup before reloading
      if (result?.prefs) {
        savePrefs(result.prefs);
      }
      setDriveMsg('✓ Restored successfully. Reloading…');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { setDriveMsg(`Restore failed: ${e.message}`); setDriveWorking(false); }
  }

  async function disconnectGoogle() {
    if (!confirm('Disconnect Google Drive? Automatic backups will stop.')) return;
    await api.disconnectGoogle();
    setDriveStatus(s => ({ ...s, connected: false, email: null }));
    setDriveMsg('');
    setShowDriveBackups(false);
  }

  async function saveSessionAsTemplate(sessionId) {
    if (!templateNameInput.trim()) return;
    await api.saveAsTemplate(sessionId, { name: templateNameInput.trim() });
    setSavingTemplate(null);
    setTemplateNameInput('');
    loadTemplates();
  }

  async function loadSessions() {
    const data = await api.getSessions();
    setSessions(data);
    if (data.length) setOpenSessionIds(prev => prev.length ? prev : [data[0].id]);
  }

  async function createSession(e) {
    e.preventDefault();
    if (sessionForm.target_date <= sessionForm.start_date) {
      alert('Target date must be after the start date.');
      return;
    }
    const s = await api.createSession(sessionForm);
    setSessionForm({ start_date: today, target_date: defaultTargetDate(prefs.defaultDuration), notes: '', template_id: '' });
    setSessions(prev => [s, ...prev]);
    setOpenSessionIds(prev => [s.id, ...prev]);
    setAddingSession(false);
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
    setEditingSession(null);
  }

  async function deleteSession(id) {
    if (!window.confirm('Delete this session and all its regimens?')) return;
    await api.deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    setOpenSessionIds(prev => prev.filter(sid => sid !== id));
  }

  async function submitCopySession(e) {
    e.preventDefault();
    const s = await api.copySession(copyingSession, copyForm);
    setCopyingSession(null);
    setSessions(prev => [s, ...prev]);
    setOpenSessionIds(prev => [s.id, ...prev]);
  }

  function daysLeftBadge(targetDate) {
    const d = Math.ceil((new Date(targetDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (d < 0) return <span className="text-xs text-red-400 font-mono">{Math.abs(d)}d overdue</span>;
    return <span className="text-xs text-violet-400 font-mono">{d}d left</span>;
  }

  function toggleSession(id) {
    setOpenSessionIds(prev =>
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  }

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
    const parsed = JSON.parse(text);
    await api.restore(parsed);
    // Restore client-side prefs if present in the backup
    if (parsed.prefs) {
      savePrefs(parsed.prefs);
      setPrefs(parsed.prefs);
      applyPrefs(parsed.prefs);
    }
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
    setOpenSessionIds([]);
    setSessions([]);
    await loadSupplements();
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 p-3 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-3">
          <div className="text-violet-500 shrink-0">
            <svg viewBox="0 0 12 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4 h-8 sm:w-5 sm:h-10">
              <rect x="1" y="1" width="10" height="22" rx="5" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="1.75" y1="12" x2="10.25" y2="12" stroke="currentColor" strokeWidth="1.5"/>
              <rect x="1" y="1" width="10" height="11" rx="5" fill="currentColor" fillOpacity="0.35"/>
            </svg>
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-none">PillPipe</h1>
            <p className="hidden sm:block text-gray-500 text-xs sm:text-sm mt-1 tracking-wide">Supplement inventory & shortfall tracking</p>
          </div>
        </div>
        <div className="flex items-center">
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1 w-full sm:w-auto">
            <button onClick={() => setView('regimens')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded text-sm font-medium transition-colors ${view === 'regimens' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              Regimens
            </button>
            <button onClick={() => setView('supplements')}
              className={`flex-1 sm:flex-none px-3 py-1.5 rounded text-sm font-medium transition-colors ${view === 'supplements' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              Supplements
            </button>
            <button onClick={() => setView('settings')} title="Settings"
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${view === 'settings' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Settings page */}
      {view === 'settings' && (
        <div className="max-w-lg space-y-3">
          {/* Data */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
            <button onClick={() => { toggleSection('data'); if (!openSections.data) loadDriveStatus(); }}
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

                {/* Google Drive Backup */}
                <div className="border-t border-gray-800 pt-3 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-gray-200 font-medium">Google Drive Backup</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {driveStatus?.connected
                          ? `Connected as ${driveStatus.email}`
                          : 'Automatically back up your data to Google Drive.'}
                      </p>
                    </div>
                    {driveStatus?.connected
                      ? <button onClick={disconnectGoogle}
                          className="shrink-0 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 text-sm font-medium">
                          Disconnect
                        </button>
                      : <a href="/api/auth/google"
                          className="shrink-0 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
                          Connect
                        </a>
                    }
                  </div>

                  {driveMsg && (
                    <p className={`text-xs px-3 py-2 rounded ${driveMsg.startsWith('✓') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                      {driveMsg}
                    </p>
                  )}

                  {driveStatus?.connected && (
                    <div className="space-y-3 pt-1">
                      {/* Frequency picker */}
                      <div>
                        <p className="text-xs text-gray-400 font-medium mb-2">Backup frequency</p>
                        <div className="space-y-1.5">
                          {[
                            { value: 'manual', label: 'Manual only', desc: 'You control when backups happen. Nothing runs automatically.' },
                            { value: 'daily', label: 'Daily', desc: 'A backup runs automatically once a day at 2am. Set-it-and-forget-it protection.' },
                            { value: 'on_change', label: 'On every change', desc: 'A backup runs whenever your data changes. Maximum protection — more Drive history.' },
                          ].map(opt => (
                            <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                              <input type="radio" name="driveFrequency" value={opt.value}
                                checked={driveStatus.frequency === opt.value}
                                onChange={async () => {
                                  await api.setDriveFrequency(opt.value);
                                  setDriveStatus(s => ({ ...s, frequency: opt.value }));
                                }}
                                className="mt-0.5 accent-violet-500" />
                              <div>
                                <p className="text-sm text-gray-200">{opt.label}</p>
                                <p className="text-xs text-gray-500">{opt.desc}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Last backup + manual trigger */}
                      <div className="flex items-center justify-between gap-4 pt-1">
                        <p className="text-xs text-gray-500">
                          {driveStatus.last_backup_at
                            ? `Last backup: ${new Date(driveStatus.last_backup_at).toLocaleString()}`
                            : 'No backups yet.'}
                        </p>
                        <button onClick={driveBackupNow} disabled={driveWorking}
                          className="shrink-0 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 text-sm font-medium">
                          {driveWorking ? 'Working…' : 'Backup Now'}
                        </button>
                      </div>

                      {/* Restore from Drive */}
                      <div className="pt-1">
                        <button onClick={async () => {
                            if (!showDriveBackups) await loadDriveBackups();
                            setShowDriveBackups(s => !s);
                          }}
                          className="text-xs text-violet-400 hover:text-violet-300">
                          {showDriveBackups ? '▲ Hide Drive backups' : '▼ View & restore Drive backups'}
                        </button>
                        {showDriveBackups && (
                          <div className="mt-2 space-y-1.5">
                            {driveBackups.length === 0
                              ? <p className="text-xs text-gray-500">No backups found in Drive.</p>
                              : driveBackups.map(f => (
                                  <div key={f.id} className="flex items-center justify-between gap-3 py-1 border-b border-gray-800/50 last:border-0">
                                    <div>
                                      <p className="text-xs text-gray-300 truncate">{f.name}</p>
                                      <p className="text-xs text-gray-600">{new Date(f.createdTime).toLocaleString()}</p>
                                    </div>
                                    <button onClick={() => driveRestoreFile(f.id, f.name)}
                                      disabled={driveWorking}
                                      className="shrink-0 text-xs text-amber-400 hover:text-amber-300 px-2 py-1 rounded hover:bg-gray-800 disabled:opacity-40">
                                      Restore
                                    </button>
                                  </div>
                                ))
                            }
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Templates */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
            <button onClick={() => { toggleSection('templates'); if (!openSections.templates) loadTemplates(); }}
              className="w-full flex items-center justify-between px-5 py-4 text-left">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Templates</h2>
              <span className="text-gray-600 text-xs">{openSections.templates ? '▲' : '▼'}</span>
            </button>
            {openSections.templates && (
              <div className="px-5 pb-5 border-t border-gray-800 pt-4">
                {templates.length === 0 ? (
                  <p className="text-sm text-gray-500">No saved templates.</p>
                ) : (
                  <ul className="space-y-2">
                    {templates.map(t => (
                      <li key={t.id} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-gray-200 truncate">{t.name}</span>
                        <button
                          onClick={async () => { await api.deleteTemplate(t.id); loadTemplates(); }}
                          className="shrink-0 text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors">
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Appearance */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
            <button onClick={() => toggleSection('appearance')}
              className="w-full flex items-center justify-between px-5 py-4 text-left">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Appearance</h2>
              <span className="text-gray-600 text-xs">{openSections.appearance ? '▲' : '▼'}</span>
            </button>
            {openSections.appearance && (
              <div className="px-5 pb-5 space-y-5 border-t border-gray-800 pt-4">
                {/* Theme color */}
                <div>
                  <p className="text-sm text-gray-200 font-medium mb-3">Theme color</p>
                  <div className="flex flex-wrap gap-2 items-center">
                    {PRESET_COLORS.map(({ key, hex }) => (
                      <button key={key} onClick={() => selectPresetColor(key)}
                        title={key.charAt(0).toUpperCase() + key.slice(1)}
                        style={{ backgroundColor: hex }}
                        className={`w-8 h-8 rounded-full transition-transform ${prefs.accentColor === key ? 'ring-2 ring-offset-2 ring-offset-gray-900 ring-white scale-110' : 'opacity-60 hover:opacity-100'}`} />
                    ))}
                    {/* Custom color picker */}
                    <label title="Custom color"
                      className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-transform overflow-hidden border-2 ${prefs.accentColor === 'custom' ? 'border-white scale-110' : 'border-gray-600 opacity-60 hover:opacity-100'}`}
                      style={prefs.accentColor === 'custom' && prefs.customColor ? { backgroundColor: prefs.customColor } : { background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
                      <input type="color"
                        className="opacity-0 absolute w-0 h-0"
                        value={prefs.customColor || '#ffffff'}
                        onChange={e => {
                          const hex = e.target.value;
                          const next = { ...prefs, accentColor: 'custom', customColor: hex };
                          savePrefs(next);
                          applyAccentColor('custom', hex);
                          setPrefs(next);
                          api.savePrefs(next).catch(() => {});
                        }} />
                    </label>
                  </div>
                </div>
                {/* Font size */}
                <div>
                  <p className="text-sm text-gray-200 font-medium mb-3">Font size</p>
                  <div className="flex gap-2">
                    {[
                      { key: 'small',  label: 'Small'  },
                      { key: 'medium', label: 'Medium' },
                      { key: 'large',  label: 'Large'  },
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => updatePref('fontSize', key)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${prefs.fontSize === key ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Color scheme */}
                <div>
                  <p className="text-sm text-gray-200 font-medium mb-3">Color scheme</p>
                  <div className="flex gap-2">
                    {[
                      { key: 'system', label: 'System' },
                      { key: 'dark',   label: 'Dark'   },
                      { key: 'light',  label: 'Light'  },
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => updatePref('colorScheme', key)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${(prefs.colorScheme ?? 'system') === key ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Preferences */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
            <button onClick={() => toggleSection('preferences')}
              className="w-full flex items-center justify-between px-5 py-4 text-left">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Preferences</h2>
              <span className="text-gray-600 text-xs">{openSections.preferences ? '▲' : '▼'}</span>
            </button>
            {openSections.preferences && (
              <div className="px-5 pb-5 space-y-5 border-t border-gray-800 pt-4">
                {/* Date format */}
                <div>
                  <p className="text-sm text-gray-200 font-medium mb-3">Date format</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'locale', label: 'Browser default' },
                      { key: 'mdy',    label: 'MM/DD/YYYY'      },
                      { key: 'dmy',    label: 'DD/MM/YYYY'      },
                      { key: 'ymd',    label: 'YYYY-MM-DD'      },
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => updatePref('dateFormat', key)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${prefs.dateFormat === key ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Default session duration */}
                <div>
                  <p className="text-sm text-gray-200 font-medium mb-1">Default session duration</p>
                  <p className="text-xs text-gray-500 mb-3">Pre-fills the target date when creating a new session.</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 0,   label: 'None'    },
                      { key: 30,  label: '30 days' },
                      { key: 60,  label: '60 days' },
                      { key: 90,  label: '90 days' },
                      { key: 120, label: '120 days'},
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => updatePref('defaultDuration', key)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${prefs.defaultDuration === key ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Notifications */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
            <button onClick={() => toggleSection('notifications')}
              className="w-full flex items-center justify-between px-5 py-4 text-left">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Notifications</h2>
              <span className="text-gray-600 text-xs">{openSections.notifications ? '▲' : '▼'}</span>
            </button>
            {openSections.notifications && (
              <div className="px-5 pb-5 space-y-4 border-t border-gray-800 pt-4">
                {notifStatus === 'needs-https' && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-yellow-400 font-medium">HTTPS required for push notifications</p>
                    <p className="text-xs text-gray-400">
                      Your browser blocks Web Push over plain HTTP. To enable notifications, access PillPipe via HTTPS — enable HTTPS in your Tailscale settings (Serve / Funnel), or use a reverse proxy with a TLS certificate.
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      The Android app will use native push notifications and won&apos;t have this limitation.
                    </p>
                  </div>
                )}
                {notifStatus === 'unsupported' && (
                  <p className="text-xs text-gray-500">Push notifications are not supported in this browser.</p>
                )}
                {notifStatus !== 'unsupported' && notifStatus !== 'needs-https' && (
                  <>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm text-gray-200 font-medium">Push Notifications</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {notifStatus === 'granted' ? 'Enabled — reminders will be sent to this device.' : 'Receive dose reminders on this device.'}
                        </p>
                        {notifStatus === 'denied' && <p className="text-xs text-red-400 mt-0.5">Permission denied — allow notifications in browser settings.</p>}
                      </div>
                      {notifStatus === 'granted' ? (
                        <button onClick={disableNotifications}
                          className="shrink-0 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 text-sm font-medium">
                          Disable
                        </button>
                      ) : (
                        <button onClick={enableNotifications} disabled={notifStatus === 'denied' || notifStatus === 'requesting'}
                          className="shrink-0 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium">
                          {notifStatus === 'requesting' ? 'Requesting…' : 'Enable'}
                        </button>
                      )}
                    </div>
                    {notifStatus === 'granted' && (
                      <div className="border-t border-gray-800 pt-3 space-y-2">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm text-gray-200 font-medium">Send Test</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Fire a test notification right now.
                              {' '}<span className="text-gray-600">If the app is open, check your OS notification tray.</span>
                            </p>
                          </div>
                          <button
                            disabled={testResult === 'sending'}
                            onClick={async () => {
                              setTestResult('sending');
                              try {
                                await api.pushTest();
                                setTestResult('sent');
                                setTimeout(() => setTestResult(''), 4000);
                              } catch (e) {
                                setTestResult(e.message || 'Failed');
                                setTimeout(() => setTestResult(''), 5000);
                              }
                            }}
                            className="shrink-0 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 text-sm font-medium">
                            {testResult === 'sending' ? 'Sending…' : 'Test'}
                          </button>
                        </div>
                        {testResult === 'sent' && (
                          <p className="text-xs text-green-400">✓ Notification sent — check your notification tray if the app is in focus.</p>
                        )}
                        {testResult && testResult !== 'sent' && testResult !== 'sending' && (
                          <p className="text-xs text-red-400">✕ {testResult}</p>
                        )}
                      </div>
                    )}
                    <div className="border-t border-gray-800 pt-3">
                      <p className="text-xs text-gray-500">Reminder times are set per-regimen in the Regimens view.</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Support — WIP: hidden until donation pages are set up; re-enable by removing the eslint-disable and false && */}
          {/* eslint-disable-next-line no-constant-binary-expression */}
          {false && (
          <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
            <button onClick={() => toggleSection('support')}
              className="w-full flex items-center justify-between px-5 py-4 text-left">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Support the Project</h2>
              <span className="text-gray-600 text-xs">{openSections.support ? '▲' : '▼'}</span>
            </button>
            {openSections.support && (
              <div className="px-5 pb-5 space-y-4 border-t border-gray-800 pt-4">
                <p className="text-xs text-gray-400 leading-relaxed">
                  PillPipe is free, open-source, and self-hosted — no subscriptions, no ads. If it&apos;s useful to you, a small donation helps cover development time and keeps the project going.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <a href="https://ko-fi.com/pillpipe" target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#FF5E5B] hover:bg-[#e54f4c] text-white text-sm font-medium transition-colors">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
                      <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z"/>
                    </svg>
                    Ko-fi
                  </a>
                  <a href="https://github.com/sponsors/theovit" target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium transition-colors border border-gray-700">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0">
                      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"/>
                    </svg>
                    GitHub Sponsors
                  </a>
                </div>
                <p className="text-xs text-gray-600">Donations go toward hosting costs and development time. No pressure — the app is free either way.</p>
              </div>
            )}
          </div>
          )}

          {/* About */}
          <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
            <button onClick={() => toggleSection('about')}
              className="w-full flex items-center justify-between px-5 py-4 text-left">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">About</h2>
              <span className="text-gray-600 text-xs">{openSections.about ? '▲' : '▼'}</span>
            </button>
            {openSections.about && (
              <div className="px-5 pb-5 space-y-4 border-t border-gray-800 pt-4">
                {/* App identity */}
                <div className="flex items-center gap-3">
                  <div className="text-violet-500 shrink-0">
                    <svg viewBox="0 0 12 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4 h-8">
                      <rect x="1" y="1" width="10" height="22" rx="5" stroke="currentColor" strokeWidth="1.5"/>
                      <line x1="1.75" y1="12" x2="10.25" y2="12" stroke="currentColor" strokeWidth="1.5"/>
                      <rect x="1" y="1" width="10" height="11" rx="5" fill="currentColor" fillOpacity="0.35"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white leading-none">
                      PillPipe
                      {appVersion && <span className="ml-2 text-xs font-mono text-gray-500">v{appVersion}</span>}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Supplement inventory &amp; shortfall tracking</p>
                  </div>
                </div>
                {/* Description */}
                <p className="text-xs text-gray-400 leading-relaxed">
                  Track supplement regimens, calculate shortfalls before your next appointment, and manage inventory — all in a self-hosted app that stays on your own network.
                </p>
                {/* Links */}
                <div className="border-t border-gray-800 pt-3 space-y-2.5">
                  <a href="https://github.com/theovit/PillPipe" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"/>
                    </svg>
                    GitHub — theovit/PillPipe
                  </a>
                  <p className="flex items-center gap-2 text-xs text-gray-600">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0 text-gray-700">
                      <path d="M11.584 2.376a.75.75 0 0 1 .832 0l9 6a.75.75 0 1 1-.832 1.248L12 3.901 3.416 9.624a.75.75 0 0 1-.832-1.248l9-6Z"/>
                      <path fillRule="evenodd" d="M20.25 10.332v9.918H21a.75.75 0 0 1 0 1.5H3a.75.75 0 0 1 0-1.5h.75v-9.918a.75.75 0 0 1 .634-.74A49.109 49.109 0 0 1 12 9c2.59 0 5.134.202 7.616.592a.75.75 0 0 1 .634.74Zm-7.5 2.418a.75.75 0 0 0-1.5 0v6h1.5v-6Zm3 0a.75.75 0 0 0-1.5 0v6h1.5v-6Zm-6 0a.75.75 0 0 0-1.5 0v6h1.5v-6Z" clipRule="evenodd"/>
                    </svg>
                    MIT License · Open Source
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`grid grid-cols-1 gap-4 sm:gap-6 ${view === 'supplements' ? '' : 'lg:grid-cols-3'} ${view === 'settings' ? 'hidden' : ''}`}>
        {/* Sidebar: Sessions */}
        {view !== 'supplements' && <div className="lg:col-span-1 space-y-4">
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Sessions</h2>
              <button onClick={() => { if (!addingSession) { loadTemplates(); setSessionForm(f => ({ ...f, target_date: defaultTargetDate(prefs.defaultDuration) })); } setAddingSession(a => !a); setEditingSession(null); }}
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
                {templates.length > 0 && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">From template <span className="text-gray-600">(optional)</span></label>
                    <select value={sessionForm.template_id}
                      onChange={e => setSessionForm(f => ({ ...f, template_id: e.target.value }))}
                      className={inputCls}>
                      <option value="">Blank session</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
                <button type="submit" className="w-full py-2.5 sm:py-2 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
                  Create Session
                </button>
              </form>
            )}

            {/* Sessions list — all sessions; click to toggle open/closed */}
            {sessions.length === 0 && !addingSession && (
              <p className="text-xs text-gray-600 text-center py-2">No sessions yet.</p>
            )}

            {sessions.length > 0 && !addingSession && (
              <div className="space-y-1">
                {sessions.map(s => {
                  const isOpen = openSessionIds.includes(s.id);
                  return (
                    <div key={s.id}>
                      {editingSession?.id === s.id ? (
                        <form onSubmit={saveSession} className="space-y-1.5 mb-1 pt-1">
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
                              onClick={() => { setEditingSession(null); setCopyingSession(s.id); setCopyForm({ start_date: today, target_date: '' }); }}>Copy</button>
                            <button type="button" className="sm:hidden px-3 py-2.5 rounded text-red-400 hover:text-red-300 text-sm ml-auto"
                              onClick={() => { setEditingSession(null); deleteSession(s.id); }}>Delete</button>
                          </div>
                        </form>
                      ) : (
                        <div
                          className={`rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${isOpen ? 'bg-violet-700/20 border border-violet-600/30' : 'hover:bg-gray-800 border border-transparent'}`}
                          onClick={() => toggleSession(s.id)}>
                          <div className="flex items-start gap-1">
                            <div className="flex-1 min-w-0">
                              <div className={`font-medium flex items-center gap-2 flex-wrap text-sm ${isOpen ? 'text-violet-300' : 'text-gray-400'}`}>
                                <span className="font-mono">→ {formatDate(s.target_date, prefs.dateFormat)}</span>
                                {daysLeftBadge(s.target_date)}
                              </div>
                              <div className="text-xs text-gray-600 mt-0.5 font-mono">from {formatDate(s.start_date, prefs.dateFormat)}</div>
                              {s.notes && <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{s.notes}</div>}
                            </div>
                            <button onClick={e => { e.stopPropagation(); setCopyingSession(s.id); setCopyForm({ start_date: today, target_date: '' }); }}
                              className="hidden sm:block text-gray-500 hover:text-gray-300 p-1.5 shrink-0" title="Copy to new session">⧉</button>
                            <button onClick={e => { e.stopPropagation(); setSavingTemplate(s.id); setTemplateNameInput(''); }}
                              className="hidden sm:block text-gray-500 hover:text-gray-300 p-1.5 shrink-0" title="Save as template">☆</button>
                            <button onClick={e => { e.stopPropagation(); setEditingSession({ ...s, start_date: s.start_date.slice(0, 10), target_date: s.target_date.slice(0, 10), notes: s.notes || '' }); }}
                              className="hidden sm:block text-gray-500 hover:text-gray-300 p-1.5 shrink-0">✎</button>
                            <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                              className="hidden sm:block text-red-500 hover:text-red-400 p-1.5 shrink-0">✕</button>
                          </div>
                        </div>
                      )}

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

                      {savingTemplate === s.id && (
                        <div className="mt-1 space-y-1.5 px-3 py-3 bg-gray-800/50 rounded border border-gray-700">
                          <p className="text-xs text-gray-400 font-medium">Save as template</p>
                          <input type="text" placeholder="Template name" value={templateNameInput}
                            onChange={e => setTemplateNameInput(e.target.value)}
                            className={inputCls} autoFocus />
                          <div className="flex gap-2 pt-0.5">
                            <button type="button" onClick={() => saveSessionAsTemplate(s.id)}
                              disabled={!templateNameInput.trim()}
                              className="px-3 py-2 sm:py-1 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm">Save</button>
                            <button type="button" onClick={() => setSavingTemplate(null)}
                              className="px-3 py-2 sm:py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>}

        {/* Main panel */}
        <div className={view === 'supplements' ? 'col-span-full' : 'lg:col-span-2'} style={{minWidth: 0}}>
          {view === 'supplements' ? (
            <SupplementsPanel supplements={supplements} onUpdate={loadSupplements} />
          ) : openSessionIds.length > 0 ? (
            <div className="space-y-4">
              {openSessionIds.map(id => {
                const s = sessions.find(sess => sess.id === id);
                return s ? (
                  <SessionPane
                    key={id}
                    session={s}
                    supplements={supplements}
                    prefs={prefs}
                    notifStatus={notifStatus}
                    onClose={() => setOpenSessionIds(prev => prev.filter(sid => sid !== id))}
                  />
                ) : null;
              })}
            </div>
          ) : (
            <p className="text-center text-gray-600 py-16">
              {sessions.length > 0 ? 'Select a session to view its regimens.' : 'Create a session to get started.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
