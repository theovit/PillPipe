// @atlas-entrypoint: App — substantial file
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AdherenceCalendar from '@/components/AdherenceCalendar';
import DateField from '@/components/DateField';
import { getDb, uuid } from '@/db/database';
import { calculate } from '@/engine/calculator';
import { Phase, Regimen, Session, Supplement } from '@/utils/types';
import { daysUntil, fmtAmount, formatDate, todayISO } from '@/utils/dates';
import { cancelReminder, scheduleReminder } from '@/utils/notifications';

const inputCls =
  'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-200 text-base';
const labelCls = 'text-xs text-gray-500 mb-1';

const DOW_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function phaseDurLabel(days: number): string {
  if (days % 7 === 0) return `${days / 7}wk`;
  return `${days}d`;
}

function phaseLabel(p: Phase, unit: string): string {
  const isIndef = p.indefinite === 1 || p.indefinite === true;
  const dur = isIndef ? '∞' : phaseDurLabel(p.duration_days);
  const dow = p.days_of_week ? JSON.parse(p.days_of_week) as number[] : null;
  const dowStr = dow && dow.length > 0 && dow.length < 7
    ? ' · ' + dow.map((d) => DOW_LABELS[d]).join(' ')
    : '';
  return `${fmtAmount(Number(p.dosage), unit)}/dose · ${dur}${dowStr}`;
}

export default function RegimensScreen() {
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionModal, setSessionModal] = useState(false);

  // Session form
  const [sessionStart, setSessionStart] = useState(todayISO());
  const [sessionTarget, setSessionTarget] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');

  // Regimen data for open session
  const [regimens, setRegimens] = useState<Regimen[]>([]);
  const [phases, setPhases] = useState<Record<string, Phase[]>>({});
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [calcResults, setCalcResults] = useState<Record<string, ReturnType<typeof calculate>>>({});
  const [regimenModal, setRegimenModal] = useState(false);
  const [selectedSupId, setSelectedSupId] = useState('');

  // Edit session
  const [editModal, setEditModal] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Regimen notes
  const [regimenNotes, setRegimenNotes] = useState<Record<string, string>>({});

  // Reminder times
  const [reminderTimes, setReminderTimes] = useState<Record<string, string>>({});
  const [showReminderPicker, setShowReminderPicker] = useState<string | null>(null);

  // Templates
  const [templates, setTemplates] = useState<{ id: string; name: string; data: string }[]>([]);
  const [templateModal, setTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Shopping list modal
  const [shoppingListModal, setShoppingListModal] = useState(false);

  // Phase editor state
  const [phaseModal, setPhaseModal] = useState(false);
  const [editingPhase, setEditingPhase] = useState<Phase | null>(null);
  const [phaseRegimenId, setPhaseRegimenId] = useState('');
  const [phaseUnit, setPhaseUnit] = useState('capsules');
  const [phaseDosage, setPhaseDosage] = useState('');
  const [phaseDuration, setPhaseDuration] = useState('30');
  const [phaseDurationUnit, setPhaseDurationUnit] = useState<'days' | 'weeks'>('days');
  const [phaseIndefinite, setPhaseIndefinite] = useState(false);
  const [phaseDow, setPhaseDow] = useState<number[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadSessions();
      loadTemplates();
    }, []),
  );

  async function loadSessions() {
    setLoading(true);
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<Session>(
        'SELECT * FROM sessions ORDER BY target_date DESC',
      );
      setSessions(rows);
    } catch {
      // SQLite unavailable (e.g. web preview)
    }
    setLoading(false);
  }

  async function loadTemplates() {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<{ id: string; name: string; data: string }>(
        'SELECT id, name, data FROM session_templates ORDER BY created_at DESC',
      );
      setTemplates(rows);
    } catch { /* no-op */ }
  }

  async function saveAsTemplate() {
    if (!editingSession || !templateName.trim()) return;
    try {
      const db = await getDb();
      const regs = await db.getAllAsync<Regimen>(
        'SELECT * FROM regimens WHERE session_id = ?',
        [editingSession.id],
      );
      const regimenData = await Promise.all(
        regs.map(async (r) => {
          const ps = await db.getAllAsync<Phase>(
            'SELECT dosage, duration_days, days_of_week, indefinite, sequence_order FROM phases WHERE regimen_id = ? ORDER BY sequence_order',
            [r.id],
          );
          return { supplement_id: r.supplement_id, notes: r.notes, phases: ps };
        }),
      );
      const data = JSON.stringify({ regimens: regimenData });
      await db.runAsync(
        'INSERT INTO session_templates (id, name, data) VALUES (?, ?, ?)',
        [uuid(), templateName.trim(), data],
      );
      setTemplateModal(false);
      setTemplateName('');
      await loadTemplates();
      Alert.alert('Template saved', `"${templateName.trim()}" saved.`);
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  }

  async function applyTemplate(db: SQLite.SQLiteDatabase, sessionId: string, templateId: string) {
    const row = await db.getFirstAsync<{ data: string }>(
      'SELECT data FROM session_templates WHERE id = ?',
      [templateId],
    );
    if (!row) return;
    const parsed = JSON.parse(row.data) as {
      regimens: Array<{ supplement_id: string; notes: string | null; phases: Phase[] }>;
    };
    for (const tr of parsed.regimens) {
      const supExists = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM supplements WHERE id = ?',
        [tr.supplement_id],
      );
      if (!supExists) continue;
      const newRegimenId = uuid();
      await db.runAsync(
        'INSERT INTO regimens (id, session_id, supplement_id, notes) VALUES (?, ?, ?, ?)',
        [newRegimenId, sessionId, tr.supplement_id, tr.notes],
      );
      for (const p of tr.phases) {
        await db.runAsync(
          'INSERT INTO phases (id, regimen_id, dosage, duration_days, days_of_week, indefinite, sequence_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uuid(), newRegimenId, p.dosage, p.duration_days, p.days_of_week, p.indefinite, p.sequence_order],
        );
      }
    }
  }

  async function openSession(id: string) {
    if (openSessionId === id) { setOpenSessionId(null); return; }
    setOpenSessionId(id);
    setCalcResults({});
    try {
      const db = await getDb();

      const sups = await db.getAllAsync<Supplement>('SELECT * FROM supplements ORDER BY name');
      setSupplements(sups);

      const regs = await db.getAllAsync<Regimen>(
        `SELECT r.*, s.name AS supplement_name, s.brand, s.pills_per_bottle,
                s.price, s.unit, s.drops_per_ml, s.current_inventory
         FROM regimens r JOIN supplements s ON s.id = r.supplement_id
         WHERE r.session_id = ? ORDER BY r.created_at`,
        [id],
      );
      setRegimens(regs);

      const phaseMap: Record<string, Phase[]> = {};
      const notesMap: Record<string, string> = {};
      for (const r of regs) {
        const ps = await db.getAllAsync<Phase>(
          'SELECT * FROM phases WHERE regimen_id = ? ORDER BY sequence_order',
          [r.id],
        );
        phaseMap[r.id] = ps;
        notesMap[r.id] = r.notes ?? '';
      }
      setPhases(phaseMap);
      setRegimenNotes(notesMap);
      const timesMap: Record<string, string> = {};
      for (const r of regs) if (r.reminder_time) timesMap[r.id] = r.reminder_time.slice(0, 5);
      setReminderTimes(timesMap);
      await loadTodayLogs(regs.map((r) => r.id));
    } catch {
      // no-op
    }
  }

  async function reloadOpenSession() {
    if (openSessionId) {
      // Re-fetch regimens + phases without toggling open state
      try {
        const db = await getDb();
        const sups = await db.getAllAsync<Supplement>('SELECT * FROM supplements ORDER BY name');
        setSupplements(sups);

        const regs = await db.getAllAsync<Regimen>(
          `SELECT r.*, s.name AS supplement_name, s.brand, s.pills_per_bottle,
                  s.price, s.unit, s.drops_per_ml, s.current_inventory
           FROM regimens r JOIN supplements s ON s.id = r.supplement_id
           WHERE r.session_id = ? ORDER BY r.created_at`,
          [openSessionId],
        );
        setRegimens(regs);

        const phaseMap: Record<string, Phase[]> = {};
        for (const r of regs) {
          const ps = await db.getAllAsync<Phase>(
            'SELECT * FROM phases WHERE regimen_id = ? ORDER BY sequence_order',
            [r.id],
          );
          phaseMap[r.id] = ps;
        }
        setPhases(phaseMap);
        const notesMap2: Record<string, string> = {};
        const timesMap2: Record<string, string> = {};
        for (const r of regs) {
          notesMap2[r.id] = r.notes ?? '';
          if (r.reminder_time) timesMap2[r.id] = r.reminder_time.slice(0, 5);
        }
        setRegimenNotes(notesMap2);
        setReminderTimes(timesMap2);
        await loadTodayLogs(regs.map((r) => r.id));
      } catch {
        // no-op
      }
    }
  }

  async function saveRegimenNotes(regimenId: string) {
    try {
      const db = await getDb();
      await db.runAsync('UPDATE regimens SET notes=? WHERE id=?', [regimenNotes[regimenId] || null, regimenId]);
    } catch { /* no-op */ }
  }

  // ── Edit session ────────────────────────────────────────────────────────────

  function openEditModal(session: Session) {
    setEditingSession(session);
    setEditStart(session.start_date);
    setEditTarget(session.target_date);
    setEditNotes(session.notes ?? '');
    setEditModal(true);
  }

  async function saveEditSession() {
    if (!editingSession || !editStart || !editTarget) return;
    try {
      const db = await getDb();
      await db.runAsync(
        'UPDATE sessions SET start_date=?, target_date=?, notes=? WHERE id=?',
        [editStart, editTarget, editNotes.trim() || null, editingSession.id],
      );
      setEditModal(false);
      loadSessions();
    } catch { Alert.alert('Error', 'Could not save session'); }
  }

  async function copySession() {
    if (!editingSession) return;
    try {
      const db = await getDb();
      const newId = uuid();
      await db.runAsync(
        'INSERT INTO sessions (id, start_date, target_date, notes) VALUES (?,?,?,?)',
        [newId, todayISO(), '', `Copy of ${editingSession.notes || formatDate(editingSession.target_date)}`],
      );
      // Copy regimens (no phases — user sets them fresh on new dates)
      const regs = await db.getAllAsync<Regimen>('SELECT * FROM regimens WHERE session_id=?', [editingSession.id]);
      for (const r of regs) {
        await db.runAsync(
          'INSERT INTO regimens (id, session_id, supplement_id, notes) VALUES (?,?,?,?)',
          [uuid(), newId, r.supplement_id, r.notes],
        );
      }
      setEditModal(false);
      loadSessions();
      Alert.alert('Session duplicated', 'Add phases to the new session before calculating.');
    } catch { Alert.alert('Error', 'Could not copy session'); }
  }

  // ── Reminder time ────────────────────────────────────────────────────────────

  async function saveReminderTime(regimenId: string, time: string | null) {
    setReminderTimes((prev) => {
      const next = { ...prev };
      if (time) next[regimenId] = time;
      else delete next[regimenId];
      return next;
    });
    try {
      const db = await getDb();
      await db.runAsync('UPDATE regimens SET reminder_time=? WHERE id=?', [time, regimenId]);
    } catch { /* no-op */ }
    // Schedule/cancel local notification
    if (time) {
      const [hh, mm] = time.split(':').map(Number);
      const reg = regimens.find((r) => r.id === regimenId);
      if (reg) scheduleReminder(regimenId, reg.supplement_name ?? 'supplement', hh, mm).catch(() => {});
    } else {
      cancelReminder(regimenId).catch(() => {});
    }
  }

  // ── Inventory quick-adjust ───────────────────────────────────────────────────

  async function adjustInventory(supplementId: string, delta: number) {
    try {
      const db = await getDb();
      await db.runAsync(
        'UPDATE supplements SET current_inventory = MAX(0, current_inventory + ?) WHERE id=?',
        [delta, supplementId],
      );
      await reloadOpenSession();
    } catch { /* no-op */ }
  }

  // ── CSV export ───────────────────────────────────────────────────────────────

  async function exportCSV() {
    const session = sessions.find((s) => s.id === openSessionId);
    if (!session) return;
    const rows = regimens.map((r) => {
      const res = calcResults[r.id];
      if (!res) return null;
      const unit = r.unit || 'capsules';
      return [
        `"${r.supplement_name}"`, `"${r.brand || ''}"`, unit,
        Number(res.currentOnHand), Number(res.pillsNeeded), Number(res.shortfall),
        Number(res.bottlesNeeded), `$${(res.estimatedCost || 0).toFixed(2)}`, res.status,
      ].join(',');
    }).filter(Boolean);
    const total = Object.values(calcResults).reduce((s, r) => s + (r.estimatedCost || 0), 0);
    const csv = [
      'Supplement,Brand,Unit,On Hand,Needed,Shortfall,Bottles,Est. Cost,Status',
      ...rows,
      `,,,,,,,$${total.toFixed(2)},Total`,
    ].join('\n');
    try {
      const path = `${FileSystem.cacheDirectory}pillpipe-${session.target_date}.csv`;
      await FileSystem.writeAsStringAsync(path, csv);
      await Sharing.shareAsync(path, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
    } catch { Alert.alert('Error', 'Could not export CSV'); }
  }

  async function createSession() {
    if (!sessionStart || !sessionTarget) { Alert.alert('Start and target dates are required'); return; }
    if (sessionTarget <= sessionStart) { Alert.alert('Target must be after start date'); return; }
    try {
      const db = await getDb();
      const newId = uuid();
      await db.runAsync(
        'INSERT INTO sessions (id,start_date,target_date,notes) VALUES (?,?,?,?)',
        [newId, sessionStart, sessionTarget, sessionNotes.trim() || null],
      );
      if (selectedTemplateId) {
        await applyTemplate(db, newId, selectedTemplateId);
        setSelectedTemplateId('');
      }
      setSessionModal(false);
      await loadSessions();
      setOpenSessionId(newId);
    } catch {
      Alert.alert('Error', 'Could not create session');
    }
  }

  async function deleteSession(id: string) {
    Alert.alert('Delete session?', 'All regimens and phases will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            const db = await getDb();
            await db.runAsync('DELETE FROM sessions WHERE id=?', [id]);
            if (openSessionId === id) setOpenSessionId(null);
            loadSessions();
          } catch { /* no-op */ }
        },
      },
    ]);
  }

  async function addRegimen() {
    if (!selectedSupId || !openSessionId) return;
    try {
      const db = await getDb();
      await db.runAsync(
        'INSERT INTO regimens (id,session_id,supplement_id) VALUES (?,?,?)',
        [uuid(), openSessionId, selectedSupId],
      );
      setRegimenModal(false);
      setSelectedSupId('');
      await reloadOpenSession();
    } catch {
      Alert.alert('Error', 'Could not add regimen');
    }
  }

  async function deleteRegimen(regimenId: string) {
    Alert.alert('Remove regimen?', 'All phases will also be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            const db = await getDb();
            await db.runAsync('DELETE FROM regimens WHERE id=?', [regimenId]);
            await reloadOpenSession();
          } catch { /* no-op */ }
        },
      },
    ]);
  }

  // ── Phase CRUD ──────────────────────────────────────────────────────────────

  function openPhaseModal(regimenId: string, unitStr: string, existing?: Phase) {
    setPhaseRegimenId(regimenId);
    setPhaseUnit(unitStr);
    if (existing) {
      setEditingPhase(existing);
      setPhaseDosage(String(existing.dosage));
      const d = existing.duration_days;
      if (d % 7 === 0 && d > 0 && d !== 9999) {
        setPhaseDurationUnit('weeks');
        setPhaseDuration(String(d / 7));
      } else {
        setPhaseDurationUnit('days');
        setPhaseDuration(String(d));
      }
      setPhaseIndefinite(existing.indefinite === 1 || existing.indefinite === true);
      setPhaseDow(existing.days_of_week ? JSON.parse(existing.days_of_week) as number[] : []);
    } else {
      setEditingPhase(null);
      setPhaseDosage('');
      setPhaseDuration('30');
      setPhaseDurationUnit('days');
      setPhaseIndefinite(false);
      setPhaseDow([]);
    }
    setPhaseModal(true);
  }

  async function savePhase() {
    const dosage = parseFloat(phaseDosage);
    if (isNaN(dosage) || dosage <= 0) { Alert.alert('Enter a valid dosage'); return; }
    const rawDur = parseInt(phaseDuration, 10);
    const dur = phaseIndefinite ? 9999 : (phaseDurationUnit === 'weeks' ? rawDur * 7 : rawDur);
    if (!phaseIndefinite && (isNaN(rawDur) || rawDur <= 0)) { Alert.alert('Enter a valid duration'); return; }
    const daysJson = phaseDow.length > 0 ? JSON.stringify([...phaseDow].sort()) : null;

    try {
      const db = await getDb();
      if (editingPhase) {
        await db.runAsync(
          'UPDATE phases SET dosage=?, duration_days=?, days_of_week=?, indefinite=? WHERE id=?',
          [dosage, dur, daysJson, phaseIndefinite ? 1 : 0, editingPhase.id],
        );
      } else {
        const rows = await db.getAllAsync<{ m: number | null }>(
          'SELECT MAX(sequence_order) as m FROM phases WHERE regimen_id=?',
          [phaseRegimenId],
        );
        const nextOrder = (rows[0]?.m ?? -1) + 1;
        await db.runAsync(
          'INSERT INTO phases (id,regimen_id,dosage,duration_days,days_of_week,indefinite,sequence_order) VALUES (?,?,?,?,?,?,?)',
          [uuid(), phaseRegimenId, dosage, dur, daysJson, phaseIndefinite ? 1 : 0, nextOrder],
        );
      }
      setPhaseModal(false);
      setCalcResults({});
      await reloadOpenSession();
    } catch (e: unknown) {
      Alert.alert('Error', String(e));
    }
  }

  async function deletePhase(phaseId: string) {
    Alert.alert('Delete phase?', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            const db = await getDb();
            await db.runAsync('DELETE FROM phases WHERE id=?', [phaseId]);
            setCalcResults({});
            await reloadOpenSession();
          } catch { /* no-op */ }
        },
      },
    ]);
  }

  function toggleDow(day: number) {
    setPhaseDow((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  // ── Dose logging ────────────────────────────────────────────────────────────

  const [todayLogs, setTodayLogs] = useState<Record<string, 'taken' | 'skipped'>>({});

  async function loadTodayLogs(regimenIds: string[]) {
    if (regimenIds.length === 0) return;
    try {
      const db = await getDb();
      const today = todayISO();
      const rows = await db.getAllAsync<{ regimen_id: string; status: 'taken' | 'skipped' }>(
        `SELECT regimen_id, status FROM dose_log WHERE log_date = ? AND regimen_id IN (${regimenIds.map(() => '?').join(',')})`,
        [today, ...regimenIds],
      );
      const map: Record<string, 'taken' | 'skipped'> = {};
      for (const row of rows) map[row.regimen_id] = row.status;
      setTodayLogs(map);
    } catch { /* no-op */ }
  }

  async function logDose(regimenId: string, status: 'taken' | 'skipped') {
    setTodayLogs((prev) => ({ ...prev, [regimenId]: status }));
    try {
      const db = await getDb();
      await db.runAsync(
        `INSERT INTO dose_log (id, regimen_id, log_date, status)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (regimen_id, log_date) DO UPDATE SET status = excluded.status`,
        [uuid(), regimenId, todayISO(), status],
      );
    } catch { /* non-critical */ }
  }

  async function logAllToday(status: 'taken' | 'skipped') {
    const updated: Record<string, 'taken' | 'skipped'> = {};
    for (const r of regimens) updated[r.id] = status;
    setTodayLogs((prev) => ({ ...prev, ...updated }));
    try {
      const db = await getDb();
      const today = todayISO();
      await Promise.all(
        regimens.map((r) =>
          db.runAsync(
            `INSERT INTO dose_log (id, regimen_id, log_date, status)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (regimen_id, log_date) DO UPDATE SET status = excluded.status`,
            [uuid(), r.id, today, status],
          ),
        ),
      );
    } catch { /* non-critical */ }
  }

  // ── Calculate ───────────────────────────────────────────────────────────────

  async function runCalculate() {
    const session = sessions.find((s) => s.id === openSessionId);
    if (!session) return;
    const results: Record<string, ReturnType<typeof calculate>> = {};
    for (const r of regimens) {
      const ps = phases[r.id] ?? [];
      if (ps.length === 0) continue;
      results[r.id] = calculate({
        phases: ps.map((p) => ({
          ...p,
          dosage: Number(p.dosage),
          duration_days: Number(p.duration_days),
        })),
        inventory: Number(r.current_inventory ?? 0),
        startDate: session.start_date,
        targetDate: session.target_date,
        pillsPerBottle: Number(r.pills_per_bottle ?? 1),
        pricePerBottle: Number(r.price ?? 0),
      });
    }
    setCalcResults(results);
  }

  async function shareShoppingList() {
    const session = sessions.find((s) => s.id === openSessionId);
    if (!session) return;
    const items = regimens
      .map((r) => ({ r, res: calcResults[r.id] }))
      .filter(({ res }) => res && res.bottlesNeeded > 0);
    if (items.length === 0) { Alert.alert('Nothing to buy — all covered!'); return; }
    const total = items.reduce((s, { res }) => s + (res.estimatedCost || 0), 0);
    const lines = [
      `Shopping List — ${formatDate(session.target_date)}`,
      '',
      ...items.map(({ r, res }) => {
        const name = r.brand ? `${r.supplement_name} (${r.brand})` : r.supplement_name;
        return `• ${name} — ${res.bottlesNeeded} bottle${res.bottlesNeeded !== 1 ? 's' : ''} — $${(res.estimatedCost || 0).toFixed(2)}`;
      }),
      '',
      `Total: $${total.toFixed(2)}`,
    ];
    await Share.share({ message: lines.join('\n') });
  }

  const openSess = sessions.find((s) => s.id === openSessionId);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-4 pb-8">
      {/* Sessions list */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Sessions</Text>
        <Pressable onPress={() => { setSelectedTemplateId(''); setSessionModal(true); }} className="bg-violet-600 rounded-lg px-3 py-1.5">
          <Text className="text-white text-sm font-medium">+ New</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color="#7c3aed" />
      ) : sessions.length === 0 ? (
        <Text className="text-gray-600 text-sm text-center mt-8">No sessions yet.</Text>
      ) : (
        sessions.map((s) => {
          const dl = daysUntil(s.target_date);
          return (
            <Pressable
              key={s.id}
              onPress={() => openSession(s.id)}
              className={`rounded-xl border p-4 mb-3 ${openSessionId === s.id ? 'bg-violet-900/20 border-violet-700/40' : 'bg-gray-900 border-gray-800'}`}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-violet-400 font-semibold flex-1">→ {formatDate(s.target_date)}</Text>
                <Text className={`text-xs font-mono mr-3 ${dl < 0 ? 'text-red-400' : 'text-violet-400'}`}>
                  {dl < 0 ? `${Math.abs(dl)}d overdue` : `${dl}d left`}
                </Text>
                <Pressable onPress={(e) => { e.stopPropagation(); openEditModal(s); }} hitSlop={8}>
                  <Text className="text-gray-600 text-sm">✎</Text>
                </Pressable>
              </View>
              <Text className="text-gray-500 text-xs mt-1">from {formatDate(s.start_date)}</Text>
              {s.notes && <Text className="text-gray-500 text-xs mt-0.5 italic">{s.notes}</Text>}
            </Pressable>
          );
        })
      )}

      {/* Open session pane */}
      {openSess && (
        <View className="mt-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
              Regimens — {formatDate(openSess.target_date)}
            </Text>
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => { setSelectedSupId(''); setRegimenModal(true); }}
                className="bg-gray-700 rounded-lg px-3 py-1.5"
              >
                <Text className="text-gray-200 text-sm">+ Add</Text>
              </Pressable>
              <Pressable onPress={runCalculate} className="bg-violet-600 rounded-lg px-3 py-1.5">
                <Text className="text-white text-sm font-medium">Calculate</Text>
              </Pressable>
            </View>
          </View>

          {/* Results summary + share */}
          {Object.keys(calcResults).length > 0 && (() => {
            const totalCost = Object.values(calcResults).reduce((s, r) => s + (r.estimatedCost || 0), 0);
            const hasShortfall = regimens.some((r) => calcResults[r.id]?.bottlesNeeded > 0);
            return (
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-xs text-gray-500">
                  Total to buy: <Text className="text-violet-300 font-mono">${totalCost.toFixed(2)}</Text>
                </Text>
                <View className="flex-row gap-2">
                  <Pressable onPress={exportCSV} className="bg-gray-700 rounded-lg px-3 py-1.5">
                    <Text className="text-gray-300 text-xs font-medium">↓ CSV</Text>
                  </Pressable>
                  {hasShortfall && (
                    <Pressable onPress={() => setShoppingListModal(true)} className="bg-gray-700 rounded-lg px-3 py-1.5">
                      <Text className="text-gray-300 text-xs font-medium">🛒 List</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })()}

          {/* Bulk dose log bar */}
          {regimens.length > 0 && (
            <View className="flex-row items-center gap-2 mb-3">
              <Text className="text-xs text-gray-600 mr-1">Today:</Text>
              <Pressable
                onPress={() => logAllToday('taken')}
                className="bg-green-900/60 rounded-lg px-3 py-1.5"
              >
                <Text className="text-green-300 text-xs font-medium">✓ All taken</Text>
              </Pressable>
              <Pressable
                onPress={() => logAllToday('skipped')}
                className="bg-gray-800 rounded-lg px-3 py-1.5"
              >
                <Text className="text-gray-400 text-xs font-medium">✗ Skip all</Text>
              </Pressable>
            </View>
          )}

          {regimens.length === 0 ? (
            <Text className="text-gray-600 text-sm text-center py-4">No regimens. Tap + Add.</Text>
          ) : (
            regimens.map((r) => {
              const res = calcResults[r.id];
              const unit = r.unit ?? 'capsules';
              const regimenPhases = phases[r.id] ?? [];
              return (
                <View key={r.id} className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 mb-3">
                  {/* Header row */}
                  <View className="flex-row items-center justify-between">
                    <Text className="text-white font-semibold flex-1 mr-2" numberOfLines={1}>{r.supplement_name}</Text>
                    <View className="flex-row items-center gap-1">
                      <Pressable
                        onPress={() => adjustInventory(r.supplement_id!, -1)}
                        className="w-7 h-7 bg-gray-700 rounded items-center justify-center"
                        hitSlop={4}
                      >
                        <Text className="text-gray-300 text-base leading-none">−</Text>
                      </Pressable>
                      <Text className="text-gray-400 text-sm font-mono min-w-[52px] text-center">
                        {fmtAmount(Number(r.current_inventory ?? 0), unit)}
                      </Text>
                      <Pressable
                        onPress={() => adjustInventory(r.supplement_id!, 1)}
                        className="w-7 h-7 bg-gray-700 rounded items-center justify-center"
                        hitSlop={4}
                      >
                        <Text className="text-gray-300 text-base leading-none">+</Text>
                      </Pressable>
                      <Pressable onPress={() => deleteRegimen(r.id)} hitSlop={8} className="ml-1">
                        <Text className="text-gray-600 text-base">✕</Text>
                      </Pressable>
                    </View>
                  </View>
                  {/* Subtitle */}
                  <Text className="text-gray-500 text-xs mt-0.5">
                    {r.brand ? `${r.brand} · ` : ''}{r.pills_per_bottle} {unit}/bottle · ${Number(r.price ?? 0).toFixed(2)}
                  </Text>

                  {/* Notes */}
                  <TextInput
                    className="text-gray-500 text-xs mt-2 bg-transparent"
                    value={regimenNotes[r.id] ?? ''}
                    onChangeText={(t) => setRegimenNotes((n) => ({ ...n, [r.id]: t }))}
                    onBlur={() => saveRegimenNotes(r.id)}
                    placeholder="Notes (e.g. take with food)…"
                    placeholderTextColor="#4b5563"
                    multiline
                  />

                  {/* Reminder time */}
                  <View className="flex-row items-center gap-2 mt-2">
                    <Text className="text-xs text-gray-600">Reminder:</Text>
                    <Pressable
                      onPress={() => setShowReminderPicker(showReminderPicker === r.id ? null : r.id)}
                      className="flex-row items-center gap-1"
                    >
                      <Text className={`text-xs ${reminderTimes[r.id] ? 'text-violet-400' : 'text-gray-600'}`}>
                        {reminderTimes[r.id] || 'none'}
                      </Text>
                    </Pressable>
                    {reminderTimes[r.id] && (
                      <Pressable onPress={() => saveReminderTime(r.id, null)} hitSlop={8}>
                        <Text className="text-gray-700 text-xs">✕</Text>
                      </Pressable>
                    )}
                  </View>
                  {showReminderPicker === r.id && (
                    <DateTimePicker
                      value={reminderTimes[r.id] ? new Date(`1970-01-01T${reminderTimes[r.id]}:00`) : new Date()}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(_, date) => {
                        setShowReminderPicker(null);
                        if (date) {
                          const hh = String(date.getHours()).padStart(2, '0');
                          const mm = String(date.getMinutes()).padStart(2, '0');
                          saveReminderTime(r.id, `${hh}:${mm}`);
                        }
                      }}
                    />
                  )}

                  {/* Phases */}
                  <View className="mt-3 border-t border-gray-700/50 pt-3">
                    {regimenPhases.length === 0 ? (
                      <Text className="text-gray-600 text-xs mb-2">No phases yet.</Text>
                    ) : (
                      regimenPhases.map((p, idx) => (
                        <Pressable
                          key={p.id}
                          onPress={() => openPhaseModal(r.id, unit, p)}
                          onLongPress={() => deletePhase(p.id)}
                          className="flex-row items-center gap-2 mb-1.5"
                        >
                          <View className="w-5 h-5 rounded-full bg-violet-900/60 border border-violet-700/50 items-center justify-center">
                            <Text className="text-violet-400 text-xs font-bold">{idx + 1}</Text>
                          </View>
                          <Text className="text-gray-300 text-xs flex-1">{phaseLabel(p, unit)}</Text>
                          <Text className="text-gray-600 text-xs">›</Text>
                        </Pressable>
                      ))
                    )}
                    {/* Phase coverage indicator */}
                    {openSess && regimenPhases.length > 0 && (() => {
                      const totalDays = Math.ceil(
                        (new Date(openSess.target_date).getTime() - new Date(openSess.start_date).getTime()) / 86400000,
                      );
                      const hasIndef = regimenPhases.some((p) => p.indefinite === 1 || p.indefinite === true);
                      const definedDays = regimenPhases.reduce((sum, p) => {
                        if (p.indefinite === 1 || p.indefinite === true) return sum;
                        return sum + p.duration_days;
                      }, 0);
                      const remaining = totalDays - definedDays;
                      let coverageText: string;
                      let coverageColor: string;
                      if (hasIndef) {
                        coverageText = 'session fully covered';
                        coverageColor = 'text-green-500';
                      } else if (remaining === 0) {
                        coverageText = `${definedDays}d defined · fully covered`;
                        coverageColor = 'text-green-500';
                      } else if (remaining > 0) {
                        coverageText = `${definedDays}/${totalDays}d defined · ${remaining}d remaining`;
                        coverageColor = 'text-violet-400';
                      } else {
                        coverageText = `${definedDays}d defined · over by ${-remaining}d`;
                        coverageColor = 'text-amber-400';
                      }
                      return (
                        <Text className={`text-xs mt-1.5 ${coverageColor}`}>{coverageText}</Text>
                      );
                    })()}
                    <Pressable
                      onPress={() => openPhaseModal(r.id, unit)}
                      className="flex-row items-center gap-1 mt-1.5"
                    >
                      <Text className="text-violet-500 text-xs font-medium">+ Add phase</Text>
                    </Pressable>
                  </View>

                  {/* Dose log buttons */}
                  <View className="flex-row items-center gap-2 mt-3">
                    {!todayLogs[r.id] ? (
                      <>
                        <Pressable
                          onPress={() => logDose(r.id, 'taken')}
                          className="bg-green-900/60 rounded-lg px-3 py-1.5"
                        >
                          <Text className="text-green-300 text-xs font-medium">✓ Taken</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => logDose(r.id, 'skipped')}
                          className="bg-gray-800 rounded-lg px-3 py-1.5"
                        >
                          <Text className="text-gray-400 text-xs font-medium">✗ Skip</Text>
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <Text className={`text-xs font-medium ${todayLogs[r.id] === 'taken' ? 'text-green-400' : 'text-gray-500'}`}>
                          {todayLogs[r.id] === 'taken' ? '✓ Taken today' : '✗ Skipped today'}
                        </Text>
                        <Pressable
                          onPress={() => logDose(r.id, todayLogs[r.id] === 'taken' ? 'skipped' : 'taken')}
                          hitSlop={8}
                        >
                          <Text className="text-gray-600 text-xs">change</Text>
                        </Pressable>
                      </>
                    )}
                  </View>

                  {/* Adherence calendar */}
                  {openSess && (
                    <View className="mt-3 border-t border-gray-700/50 pt-3">
                      <Text className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">Adherence</Text>
                      <AdherenceCalendar
                        regimenId={r.id}
                        sessionStartDate={openSess.start_date}
                        todayStatus={todayLogs[r.id] ?? null}
                        onLogToday={(status) => logDose(r.id, status)}
                      />
                    </View>
                  )}

                  {/* Shortfall result */}
                  {res && (
                    <View className={`mt-3 rounded-lg px-4 py-3 ${res.status === 'covered' ? 'bg-green-900/20 border border-green-700/30' : 'bg-amber-900/10 border border-amber-700/40'}`}>
                      {res.status === 'covered' ? (
                        <Text className="text-green-400 text-sm">✓ Covered through target date</Text>
                      ) : (
                        <>
                          <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <Text className="text-amber-400 font-medium text-sm">
                              ⚠ Buy {res.bottlesNeeded} bottle{res.bottlesNeeded !== 1 ? 's' : ''}
                              {res.estimatedCost > 0 && (
                                <Text className="text-amber-300 font-mono"> ${res.estimatedCost.toFixed(2)}</Text>
                              )}
                            </Text>
                            <Text className="text-red-400 text-xs font-mono">
                              {fmtAmount(res.shortfall, unit)} short
                            </Text>
                          </View>
                          <Text className="text-gray-500 text-xs font-mono mt-1">
                            need {fmtAmount(res.pillsNeeded, unit)} · have {fmtAmount(res.currentOnHand, unit)}
                            {res.waste > 0 ? ` · ${fmtAmount(res.waste, unit)} leftover` : ''}
                            {res.daysShort > 0 ? ` · ${res.daysShort}d short` : ''}
                          </Text>
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      )}

      {/* ── New Session Modal ── */}
      <Modal visible={sessionModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setSessionModal(false); setSelectedTemplateId(''); }}>
        <View className="flex-1 bg-background px-5" style={{ paddingTop: insets.top + 8 }}>
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-white text-lg font-semibold">New Session</Text>
            <Pressable onPress={() => { setSessionModal(false); setSelectedTemplateId(''); }}>
              <Text className="text-gray-400">Cancel</Text>
            </Pressable>
          </View>
          <View className="gap-4">
            <View>
              <Text className={labelCls}>Start date</Text>
              <DateField value={sessionStart} onChange={setSessionStart} />
            </View>
            <View>
              <Text className={labelCls}>Target date</Text>
              <DateField
                value={sessionTarget}
                onChange={setSessionTarget}
                placeholder="Select date"
                minimumDate={sessionStart ? new Date(new Date(sessionStart).getTime() + 86400000) : undefined}
              />
            </View>
            <View>
              <Text className={labelCls}>Notes</Text>
              <TextInput className={inputCls} value={sessionNotes} onChangeText={setSessionNotes} placeholder="e.g. Spring protocol" placeholderTextColor="#4b5563" />
            </View>
            {templates.length > 0 && (
              <View>
                <Text className={labelCls}>From template (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-2">
                  <Pressable
                    onPress={() => setSelectedTemplateId('')}
                    className={`px-3 py-1.5 rounded-lg mr-2 ${selectedTemplateId === '' ? 'bg-violet-600' : 'bg-gray-800 border border-gray-700'}`}
                  >
                    <Text className={`text-sm ${selectedTemplateId === '' ? 'text-white' : 'text-gray-400'}`}>None</Text>
                  </Pressable>
                  {templates.map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => setSelectedTemplateId(t.id)}
                      className={`px-3 py-1.5 rounded-lg mr-2 ${selectedTemplateId === t.id ? 'bg-violet-600' : 'bg-gray-800 border border-gray-700'}`}
                    >
                      <Text className={`text-sm ${selectedTemplateId === t.id ? 'text-white' : 'text-gray-400'}`}>{t.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
          <Pressable onPress={createSession} className="mt-8 bg-violet-600 rounded-xl py-3.5 items-center">
            <Text className="text-white font-semibold text-base">Create Session</Text>
          </Pressable>
        </View>
      </Modal>

      {/* ── Edit Session Modal ── */}
      <Modal visible={editModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditModal(false)}>
        <ScrollView className="flex-1 bg-background" contentContainerClassName="px-5 pb-10" contentContainerStyle={{ paddingTop: insets.top + 8 }}>
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-white text-lg font-semibold">Edit Session</Text>
            <Pressable onPress={() => setEditModal(false)}>
              <Text className="text-gray-400">Cancel</Text>
            </Pressable>
          </View>
          <View className="gap-4">
            <View>
              <Text className={labelCls}>Start date</Text>
              <DateField value={editStart} onChange={setEditStart} />
            </View>
            <View>
              <Text className={labelCls}>Target date</Text>
              <DateField
                value={editTarget}
                onChange={setEditTarget}
                minimumDate={editStart ? new Date(new Date(editStart).getTime() + 86400000) : undefined}
              />
            </View>
            <View>
              <Text className={labelCls}>Notes</Text>
              <TextInput className={inputCls} value={editNotes} onChangeText={setEditNotes} placeholder="e.g. Spring protocol" placeholderTextColor="#4b5563" />
            </View>
          </View>
          <Pressable onPress={saveEditSession} className="mt-8 bg-violet-600 rounded-xl py-3.5 items-center">
            <Text className="text-white font-semibold text-base">Save Changes</Text>
          </Pressable>
          <Pressable
            onPress={() => { setTemplateModal(true); setTemplateName(''); }}
            className="mt-3 bg-gray-800 border border-gray-700 rounded-xl py-3.5 items-center"
          >
            <Text className="text-gray-300 font-medium text-base">Save as Template</Text>
          </Pressable>
          <Pressable onPress={copySession} className="mt-3 bg-gray-800 border border-gray-700 rounded-xl py-3.5 items-center">
            <Text className="text-gray-300 font-medium text-base">Duplicate Session</Text>
          </Pressable>
          <Pressable
            onPress={() => { setEditModal(false); if (editingSession) deleteSession(editingSession.id); }}
            className="mt-3 border border-red-900/40 rounded-xl py-3.5 items-center"
          >
            <Text className="text-red-400 font-medium">Delete Session</Text>
          </Pressable>
        </ScrollView>
      </Modal>

      {/* ── Shopping List Modal ── */}
      <Modal visible={shoppingListModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShoppingListModal(false)}>
        <View className="flex-1 bg-background px-5" style={{ paddingTop: insets.top + 8 }}>
          <View className="flex-row items-center justify-between mb-5">
            <Text className="text-white text-lg font-semibold">Shopping List</Text>
            <Pressable onPress={() => setShoppingListModal(false)}>
              <Text className="text-gray-400">Done</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {regimens
              .map((r) => ({ r, res: calcResults[r.id] }))
              .filter(({ res }) => res && res.bottlesNeeded > 0)
              .map(({ r, res }) => (
                <View key={r.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-3">
                  <Text className="text-white font-semibold text-base">{r.supplement_name}</Text>
                  {r.brand && <Text className="text-gray-500 text-xs mt-0.5">{r.brand}</Text>}
                  <View className="flex-row justify-between items-end mt-3">
                    <View className="gap-1">
                      <Text className="text-gray-400 text-sm">
                        Shortfall: <Text className="text-amber-400 font-mono">{fmtAmount(res.shortfall ?? 0, r.unit ?? 'capsules')}</Text>
                      </Text>
                      <Text className="text-gray-400 text-sm">
                        On hand: <Text className="text-gray-300 font-mono">{fmtAmount(res.onHandNow ?? 0, r.unit ?? 'capsules')}</Text>
                      </Text>
                    </View>
                    <View className="items-end gap-1">
                      <View className="bg-violet-900/40 px-3 py-1 rounded-full">
                        <Text className="text-violet-300 font-semibold text-sm">{res.bottlesNeeded} bottle{res.bottlesNeeded !== 1 ? 's' : ''}</Text>
                      </View>
                      <Text className="text-gray-500 text-xs">${(res.estimatedCost ?? 0).toFixed(2)}</Text>
                    </View>
                  </View>
                </View>
              ))}

            {/* Total + actions */}
            {(() => {
              const items = regimens
                .map((r) => ({ r, res: calcResults[r.id] }))
                .filter(({ res }) => res && res.bottlesNeeded > 0);
              const totalCost = items.reduce((s, { res }) => s + (res.estimatedCost ?? 0), 0);
              const listText = items
                .map(({ r, res }) => `• ${r.supplement_name}${r.brand ? ` (${r.brand})` : ''} — ${res.bottlesNeeded} bottle${res.bottlesNeeded !== 1 ? 's' : ''} (~$${(res.estimatedCost ?? 0).toFixed(2)})`)
                .join('\n');
              return (
                <View className="mt-2">
                  <Text className="text-gray-500 text-sm mb-4 text-right">
                    Total: <Text className="text-violet-300 font-mono font-semibold">${totalCost.toFixed(2)}</Text>
                  </Text>
                  <Pressable
                    onPress={() => {
                      Clipboard.setString(listText);
                      Alert.alert('Copied', 'Shopping list copied to clipboard.');
                    }}
                    className="bg-gray-700 rounded-xl py-3.5 items-center mb-3"
                  >
                    <Text className="text-gray-200 font-medium">Copy to Clipboard</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => Share.share({ message: listText })}
                    className="bg-violet-600 rounded-xl py-3.5 items-center"
                  >
                    <Text className="text-white font-semibold">Share List</Text>
                  </Pressable>
                </View>
              );
            })()}
          </ScrollView>
        </View>
      </Modal>

      {/* Template name modal */}
      <Modal visible={templateModal} animationType="fade" transparent onRequestClose={() => setTemplateModal(false)}>
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full">
            <Text className="text-white font-semibold text-base mb-4">Save as Template</Text>
            <TextInput
              className={inputCls}
              value={templateName}
              onChangeText={setTemplateName}
              placeholder="Template name"
              placeholderTextColor="#4b5563"
              autoFocus
            />
            <View className="flex-row gap-3 mt-4">
              <Pressable
                onPress={() => setTemplateModal(false)}
                className="flex-1 bg-gray-800 rounded-xl py-3 items-center"
              >
                <Text className="text-gray-400 font-medium">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveAsTemplate}
                className="flex-1 bg-violet-600 rounded-xl py-3 items-center"
              >
                <Text className="text-white font-semibold">Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Add Regimen Modal ── */}
      <Modal visible={regimenModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRegimenModal(false)}>
        <View className="flex-1 bg-background px-5" style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}>
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-white text-lg font-semibold">Add Regimen</Text>
            <Pressable onPress={() => setRegimenModal(false)}>
              <Text className="text-gray-400">Cancel</Text>
            </Pressable>
          </View>
          {supplements.length === 0 ? (
            <Text className="text-gray-500 text-sm text-center mt-8">Add supplements first.</Text>
          ) : (
            <FlatList
              data={supplements}
              keyExtractor={(s) => s.id}
              renderItem={({ item: s }) => (
                <Pressable
                  onPress={() => setSelectedSupId(s.id)}
                  className={`p-4 rounded-xl mb-2 border ${selectedSupId === s.id ? 'bg-violet-900/30 border-violet-600' : 'bg-gray-900 border-gray-800'}`}
                >
                  <Text className="text-white font-medium">{s.name}</Text>
                  {s.brand && <Text className="text-gray-500 text-xs">{s.brand}</Text>}
                </Pressable>
              )}
            />
          )}
          {selectedSupId ? (
            <Pressable onPress={addRegimen} className="mt-4 bg-violet-600 rounded-xl py-3.5 items-center">
              <Text className="text-white font-semibold text-base">Add to Session</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>

      {/* ── Phase Editor Modal ── */}
      <Modal visible={phaseModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPhaseModal(false)}>
        <ScrollView className="flex-1 bg-background" contentContainerClassName="px-5 pb-10" contentContainerStyle={{ paddingTop: insets.top + 8 }}>
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-white text-lg font-semibold">
              {editingPhase ? 'Edit Phase' : 'Add Phase'}
            </Text>
            <Pressable onPress={() => setPhaseModal(false)}>
              <Text className="text-gray-400">Cancel</Text>
            </Pressable>
          </View>

          <View className="gap-5">
            {/* Dosage */}
            <View>
              <Text className={labelCls}>Dosage ({phaseUnit}/dose)</Text>
              <TextInput
                className={inputCls}
                value={phaseDosage}
                onChangeText={setPhaseDosage}
                placeholder="e.g. 2"
                placeholderTextColor="#4b5563"
                keyboardType="decimal-pad"
              />
            </View>

            {/* Indefinite toggle */}
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-gray-200 text-sm font-medium">Indefinite</Text>
                <Text className="text-gray-500 text-xs">Runs until end of session</Text>
              </View>
              <Switch
                value={phaseIndefinite}
                onValueChange={setPhaseIndefinite}
                trackColor={{ false: '#374151', true: '#7c3aed' }}
                thumbColor="#fff"
              />
            </View>

            {/* Duration (hidden if indefinite) */}
            {!phaseIndefinite && (
              <View>
                <Text className={labelCls}>Duration</Text>
                <View className="flex-row gap-2 items-center">
                  <TextInput
                    className={`${inputCls} flex-1`}
                    value={phaseDuration}
                    onChangeText={setPhaseDuration}
                    placeholder={phaseDurationUnit === 'weeks' ? '4' : '30'}
                    placeholderTextColor="#4b5563"
                    keyboardType="number-pad"
                  />
                  {(['days', 'weeks'] as const).map((u) => (
                    <Pressable
                      key={u}
                      onPress={() => setPhaseDurationUnit(u)}
                      className={`px-3 py-2.5 rounded-lg ${phaseDurationUnit === u ? 'bg-violet-600' : 'bg-gray-800 border border-gray-700'}`}
                    >
                      <Text className={`text-sm ${phaseDurationUnit === u ? 'text-white' : 'text-gray-400'}`}>
                        {u === 'days' ? 'd' : 'wk'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* Days of week */}
            <View>
              <Text className={labelCls}>Days of week (leave all off = every day)</Text>
              <View className="flex-row gap-2 mt-1">
                {DOW_LABELS.map((label, idx) => {
                  const active = phaseDow.includes(idx);
                  return (
                    <Pressable
                      key={idx}
                      onPress={() => toggleDow(idx)}
                      className={`flex-1 items-center py-2 rounded-lg border ${active ? 'bg-violet-600 border-violet-500' : 'bg-gray-800 border-gray-700'}`}
                    >
                      <Text className={`text-xs font-semibold ${active ? 'text-white' : 'text-gray-500'}`}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          <Pressable onPress={savePhase} className="mt-8 bg-violet-600 rounded-xl py-3.5 items-center">
            <Text className="text-white font-semibold text-base">
              {editingPhase ? 'Save Changes' : 'Add Phase'}
            </Text>
          </Pressable>

          {editingPhase && (
            <Pressable
              onPress={() => { setPhaseModal(false); deletePhase(editingPhase.id); }}
              className="mt-3 border border-red-900/40 rounded-xl py-3.5 items-center"
            >
              <Text className="text-red-400 font-medium">Delete Phase</Text>
            </Pressable>
          )}
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}
