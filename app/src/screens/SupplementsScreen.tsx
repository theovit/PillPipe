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
import { Supplement } from '@/utils/types';

const UNITS = ['capsules', 'tablets', 'ml', 'drops'] as const;
const TYPES = ['maintenance', 'protocol'] as const;

const inputCls =
  'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-200 text-base';
const labelCls = 'text-xs text-gray-500 mb-1';

function shortUnit(unit: string): string {
  if (unit === 'tablets') return 'tabs';
  if (unit === 'ml') return 'ml';
  if (unit === 'drops') return 'drops';
  return 'caps';
}

function bottleLabel(unit: string): string {
  if (unit === 'tablets') return 'Tabs/bottle';
  if (unit === 'ml') return 'Volume/bottle (ml)';
  if (unit === 'drops') return 'Bottle size (ml)';
  return 'Caps/bottle';
}

function inventoryDisplay(s: Supplement): string {
  const qty = Number(s.current_inventory);
  if (s.unit === 'drops') {
    const dpm = Number(s.drops_per_ml) || 20;
    return `${qty} drops (≈${(qty / dpm).toFixed(1)} ml)`;
  }
  return `${qty} ${shortUnit(s.unit)}`;
}

function isLow(s: Supplement): boolean {
  if (!s.reorder_threshold) return false;
  if (s.reorder_threshold_mode === 'units' || !s.reorder_threshold_mode) {
    return Number(s.current_inventory) <= Number(s.reorder_threshold);
  }
  return false; // 'days' mode requires phase data — skip in card
}

export default function SupplementsScreen() {
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Supplement | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [pillsPerBottle, setPillsPerBottle] = useState('60');
  const [price, setPrice] = useState('');
  const [type, setType] = useState<'maintenance' | 'protocol'>('maintenance');
  const [unit, setUnit] = useState<typeof UNITS[number]>('capsules');
  const [inventory, setInventory] = useState('0');
  const [dropsPerMl, setDropsPerMl] = useState('20');
  const [reorderThreshold, setReorderThreshold] = useState('');
  const [reorderThresholdMode, setReorderThresholdMode] = useState<'units' | 'days'>('units');

  useFocusEffect(
    useCallback(() => {
      loadSupplements();
    }, []),
  );

  async function loadSupplements() {
    setLoading(true);
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<Supplement>(
        'SELECT * FROM supplements ORDER BY name ASC',
      );
      setSupplements(rows);
    } catch { /* SQLite unavailable (e.g. web preview) */ }
    setLoading(false);
  }

  function openNew() {
    setEditing(null);
    setName(''); setBrand(''); setPillsPerBottle('60'); setPrice('');
    setType('maintenance'); setUnit('capsules'); setInventory('0');
    setDropsPerMl('20'); setReorderThreshold(''); setReorderThresholdMode('units');
    setModalVisible(true);
  }

  function openEdit(s: Supplement) {
    setEditing(s);
    setName(s.name);
    setBrand(s.brand ?? '');
    setPillsPerBottle(String(s.pills_per_bottle));
    setPrice(String(s.price));
    setType(s.type);
    setUnit(s.unit);
    setInventory(String(s.current_inventory));
    setDropsPerMl(String(s.drops_per_ml || 20));
    setReorderThreshold(s.reorder_threshold != null ? String(s.reorder_threshold) : '');
    setReorderThresholdMode((s.reorder_threshold_mode as 'units' | 'days') || 'units');
    setModalVisible(true);
  }

  async function save() {
    if (!name.trim()) { Alert.alert('Name is required'); return; }
    const db = await getDb();
    const threshold = reorderThreshold.trim() ? Number(reorderThreshold) : null;
    const dpm = unit === 'drops' ? (Number(dropsPerMl) || 20) : 20;
    if (editing) {
      await db.runAsync(
        `UPDATE supplements SET name=?,brand=?,pills_per_bottle=?,price=?,type=?,unit=?,current_inventory=?,drops_per_ml=?,reorder_threshold=?,reorder_threshold_mode=? WHERE id=?`,
        [name.trim(), brand.trim() || null, Number(pillsPerBottle), Number(price), type, unit, Number(inventory), dpm, threshold, reorderThresholdMode, editing.id],
      );
    } else {
      await db.runAsync(
        `INSERT INTO supplements (id,name,brand,pills_per_bottle,price,type,unit,current_inventory,drops_per_ml,reorder_threshold,reorder_threshold_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [uuid(), name.trim(), brand.trim() || null, Number(pillsPerBottle), Number(price), type, unit, Number(inventory), dpm, threshold, reorderThresholdMode],
      );
    }
    setModalVisible(false);
    loadSupplements();
  }

  async function deleteSupplement(id: string) {
    Alert.alert('Delete supplement?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setModalVisible(false);
          const db = await getDb();
          await db.runAsync('DELETE FROM supplements WHERE id=?', [id]);
          loadSupplements();
        },
      },
    ]);
  }

  function renderItem({ item: s }: { item: Supplement }) {
    const low = isLow(s);
    const ul = shortUnit(s.unit);
    const bottleUnit = s.unit === 'drops' ? 'ml' : ul;
    return (
      <Pressable
        onPress={() => openEdit(s)}
        className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-3"
      >
        <View className="flex-row items-start justify-between gap-3 pr-6">
          <View className="flex-1 min-w-0">
            <View className="flex-row items-center gap-2 flex-wrap">
              <Text className="text-white font-semibold text-base">{s.name}</Text>
              {low && (
                <View className="bg-amber-900/40 px-1.5 py-0.5 rounded-full">
                  <Text className="text-amber-400 text-xs">⚠ low</Text>
                </View>
              )}
            </View>
            <Text className="text-gray-500 text-xs mt-0.5">
              {s.brand ? `${s.brand} · ` : ''}{s.pills_per_bottle} {bottleUnit}/bottle · ${Number(s.price).toFixed(2)}
            </Text>
          </View>
          <View className="items-end gap-1">
            <Text className="text-gray-400 text-sm font-mono">{inventoryDisplay(s)}</Text>
            <View className={`px-2 py-0.5 rounded-full ${s.type === 'maintenance' ? 'bg-blue-900/40' : 'bg-amber-900/40'}`}>
              <Text className={`text-xs font-medium ${s.type === 'maintenance' ? 'text-blue-400' : 'text-amber-400'}`}>
                {s.type}
              </Text>
            </View>
          </View>
        </View>
        <Text className="text-gray-700 text-xs absolute top-4 right-4">›</Text>
      </Pressable>
    );
  }

  const dropsConversion = unit === 'drops' && dropsPerMl && inventory
    ? ` (≈${(Number(inventory) / (Number(dropsPerMl) || 20)).toFixed(1)} ml)`
    : '';

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
          Supplements
        </Text>
        <Pressable onPress={openNew} className="bg-violet-600 rounded-lg px-4 py-2">
          <Text className="text-white text-sm font-medium">+ Add</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color="#7c3aed" />
      ) : supplements.length === 0 ? (
        <Text className="text-gray-600 text-sm text-center mt-8">No supplements yet.</Text>
      ) : (
        <FlatList
          data={supplements}
          keyExtractor={(s) => s.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Add / Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <ScrollView className="flex-1 bg-background" contentContainerClassName="px-5 pt-6 pb-10">
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-white text-lg font-semibold">
              {editing ? 'Edit Supplement' : 'New Supplement'}
            </Text>
            <Pressable onPress={() => setModalVisible(false)}>
              <Text className="text-gray-400 text-base">Cancel</Text>
            </Pressable>
          </View>

          <View className="gap-4">
            <View>
              <Text className={labelCls}>Name *</Text>
              <TextInput
                className={inputCls}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Magnesium Glycinate"
                placeholderTextColor="#4b5563"
              />
            </View>

            <View>
              <Text className={labelCls}>Brand</Text>
              <TextInput
                className={inputCls}
                value={brand}
                onChangeText={setBrand}
                placeholder="e.g. Thorne"
                placeholderTextColor="#4b5563"
              />
            </View>

            {/* Unit selector */}
            <View>
              <Text className={labelCls}>Unit</Text>
              <View className="flex-row gap-2 flex-wrap">
                {UNITS.map((u) => (
                  <Pressable
                    key={u}
                    onPress={() => setUnit(u)}
                    className={`px-3 py-1.5 rounded-lg ${unit === u ? 'bg-violet-600' : 'bg-gray-800 border border-gray-700'}`}
                  >
                    <Text className={`text-sm ${unit === u ? 'text-white' : 'text-gray-400'}`}>{u}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Drops per ml — only shown for drops unit */}
            {unit === 'drops' && (
              <View>
                <Text className={labelCls}>Drops per ml (standard dropper = 20)</Text>
                <TextInput
                  className={inputCls}
                  value={dropsPerMl}
                  onChangeText={setDropsPerMl}
                  keyboardType="numeric"
                  placeholder="20"
                  placeholderTextColor="#4b5563"
                />
              </View>
            )}

            <View className="flex-row gap-3">
              <View className="flex-1">
                <Text className={labelCls}>{bottleLabel(unit)}</Text>
                <TextInput
                  className={inputCls}
                  value={pillsPerBottle}
                  onChangeText={setPillsPerBottle}
                  keyboardType="numeric"
                />
              </View>
              <View className="flex-1">
                <Text className={labelCls}>Price ($)</Text>
                <TextInput
                  className={inputCls}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#4b5563"
                />
              </View>
            </View>

            <View>
              <Text className={labelCls}>Inventory on hand{dropsConversion}</Text>
              <TextInput
                className={inputCls}
                value={inventory}
                onChangeText={setInventory}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Type selector */}
            <View>
              <Text className={labelCls}>Type</Text>
              <View className="flex-row gap-2">
                {TYPES.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setType(t)}
                    className={`px-3 py-1.5 rounded-lg ${type === t ? 'bg-violet-600' : 'bg-gray-800 border border-gray-700'}`}
                  >
                    <Text className={`text-sm ${type === t ? 'text-white' : 'text-gray-400'}`}>{t}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Reorder alert */}
            <View>
              <Text className={labelCls}>Reorder alert threshold (optional)</Text>
              <View className="flex-row gap-2 items-center">
                <TextInput
                  className={`${inputCls} flex-1`}
                  value={reorderThreshold}
                  onChangeText={setReorderThreshold}
                  keyboardType="numeric"
                  placeholder="Alert when on-hand drops to…"
                  placeholderTextColor="#4b5563"
                />
                <View className="flex-row gap-1">
                  {(['units', 'days'] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setReorderThresholdMode(m)}
                      className={`px-3 py-2.5 rounded-lg ${reorderThresholdMode === m ? 'bg-violet-600' : 'bg-gray-800 border border-gray-700'}`}
                    >
                      <Text className={`text-sm ${reorderThresholdMode === m ? 'text-white' : 'text-gray-400'}`}>{m}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          </View>

          <Pressable onPress={save} className="mt-8 bg-violet-600 rounded-xl py-3.5 items-center">
            <Text className="text-white font-semibold text-base">Save</Text>
          </Pressable>

          {editing && (
            <Pressable
              onPress={() => deleteSupplement(editing.id)}
              className="mt-3 py-3.5 items-center border border-red-900/40 rounded-xl"
            >
              <Text className="text-red-400 text-sm font-medium">Delete Supplement</Text>
            </Pressable>
          )}
        </ScrollView>
      </Modal>
    </View>
  );
}
