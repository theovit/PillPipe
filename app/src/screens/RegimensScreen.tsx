import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getDb, uuid } from '@/db/database';
import { calculate } from '@/engine/calculator';
import { Phase, Regimen, Session, Supplement } from '@/utils/types';
import { daysUntil, fmtAmount, formatDate, todayISO } from '@/utils/dates';

const inputCls =
  'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-200 text-base';
const labelCls = 'text-xs text-gray-500 mb-1';

export default function RegimensScreen() {
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

  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, []),
  );

  async function loadSessions() {
    setLoading(true);
    const db = await getDb();
    const rows = await db.getAllAsync<Session>(
      'SELECT * FROM sessions ORDER BY target_date DESC',
    );
    setSessions(rows);
    setLoading(false);
  }

  async function openSession(id: string) {
    if (openSessionId === id) { setOpenSessionId(null); return; }
    setOpenSessionId(id);
    setCalcResults({});
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
    for (const r of regs) {
      const ps = await db.getAllAsync<Phase>(
        'SELECT * FROM phases WHERE regimen_id = ? ORDER BY sequence_order',
        [r.id],
      );
      phaseMap[r.id] = ps;
    }
    setPhases(phaseMap);
  }

  async function createSession() {
    if (!sessionStart || !sessionTarget) { Alert.alert('Start and target dates are required'); return; }
    if (sessionTarget <= sessionStart) { Alert.alert('Target must be after start date'); return; }
    const db = await getDb();
    await db.runAsync(
      'INSERT INTO sessions (id,start_date,target_date,notes) VALUES (?,?,?,?)',
      [uuid(), sessionStart, sessionTarget, sessionNotes.trim() || null],
    );
    setSessionModal(false);
    loadSessions();
  }

  async function deleteSession(id: string) {
    Alert.alert('Delete session?', 'All regimens and phases will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const db = await getDb();
          await db.runAsync('DELETE FROM sessions WHERE id=?', [id]);
          if (openSessionId === id) setOpenSessionId(null);
          loadSessions();
        },
      },
    ]);
  }

  async function addRegimen() {
    if (!selectedSupId || !openSessionId) return;
    const db = await getDb();
    await db.runAsync(
      'INSERT INTO regimens (id,session_id,supplement_id) VALUES (?,?,?)',
      [uuid(), openSessionId, selectedSupId],
    );
    setRegimenModal(false);
    openSession(openSessionId);
  }

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

  const openSess = sessions.find((s) => s.id === openSessionId);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-4 pb-8">
      {/* Sessions list */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Sessions</Text>
        <Pressable onPress={() => setSessionModal(true)} className="bg-violet-600 rounded-lg px-3 py-1.5">
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
              onLongPress={() => deleteSession(s.id)}
              className={`rounded-xl border p-4 mb-3 ${openSessionId === s.id ? 'bg-violet-900/20 border-violet-700/40' : 'bg-gray-900 border-gray-800'}`}
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-violet-400 font-semibold">→ {formatDate(s.target_date)}</Text>
                <Text className={`text-xs font-mono ${dl < 0 ? 'text-red-400' : 'text-violet-400'}`}>
                  {dl < 0 ? `${Math.abs(dl)}d overdue` : `${dl}d left`}
                </Text>
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
                onPress={() => setRegimenModal(true)}
                className="bg-gray-700 rounded-lg px-3 py-1.5"
              >
                <Text className="text-gray-200 text-sm">+ Add</Text>
              </Pressable>
              <Pressable onPress={runCalculate} className="bg-violet-600 rounded-lg px-3 py-1.5">
                <Text className="text-white text-sm font-medium">Calculate</Text>
              </Pressable>
            </View>
          </View>

          {regimens.length === 0 ? (
            <Text className="text-gray-600 text-sm text-center py-4">No regimens. Tap + Add.</Text>
          ) : (
            regimens.map((r) => {
              const res = calcResults[r.id];
              const unit = r.unit ?? 'capsules';
              return (
                <View key={r.id} className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 mb-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-white font-semibold">{r.supplement_name}</Text>
                    <Text className="text-gray-400 text-sm font-mono">
                      {fmtAmount(Number(r.current_inventory ?? 0), unit)} on hand
                    </Text>
                  </View>
                  <Text className="text-gray-500 text-xs mt-0.5">
                    {r.brand ? `${r.brand} · ` : ''}{r.pills_per_bottle} {unit}/bottle · ${Number(r.price ?? 0).toFixed(2)}
                  </Text>

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

      {/* New Session Modal */}
      <Modal visible={sessionModal} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background px-5 pt-6">
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-white text-lg font-semibold">New Session</Text>
            <Pressable onPress={() => setSessionModal(false)}>
              <Text className="text-gray-400">Cancel</Text>
            </Pressable>
          </View>
          <View className="gap-4">
            <View>
              <Text className={labelCls}>Start date</Text>
              <TextInput className={inputCls} value={sessionStart} onChangeText={setSessionStart} placeholder="YYYY-MM-DD" placeholderTextColor="#4b5563" />
            </View>
            <View>
              <Text className={labelCls}>Target date</Text>
              <TextInput className={inputCls} value={sessionTarget} onChangeText={setSessionTarget} placeholder="YYYY-MM-DD" placeholderTextColor="#4b5563" />
            </View>
            <View>
              <Text className={labelCls}>Notes</Text>
              <TextInput className={inputCls} value={sessionNotes} onChangeText={setSessionNotes} placeholder="e.g. Spring protocol" placeholderTextColor="#4b5563" />
            </View>
          </View>
          <Pressable onPress={createSession} className="mt-8 bg-violet-600 rounded-xl py-3.5 items-center">
            <Text className="text-white font-semibold text-base">Create Session</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Add Regimen Modal */}
      <Modal visible={regimenModal} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background px-5 pt-6">
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
    </ScrollView>
  );
}
