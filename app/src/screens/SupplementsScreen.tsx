import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
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
    } catch {
      // SQLite unavailable (e.g. web preview)
    }
    setLoading(false);
  }

  function openNew() {
    setEditing(null);
    setName(''); setBrand(''); setPillsPerBottle('60'); setPrice('');
    setType('maintenance'); setUnit('capsules'); setInventory('0');
    setModalVisible(true);
  }

  function openEdit(s: Supplement) {
    setEditing(s);
    setName(s.name); setBrand(s.brand ?? ''); setPillsPerBottle(String(s.pills_per_bottle));
    setPrice(String(s.price)); setType(s.type); setUnit(s.unit); setInventory(String(s.current_inventory));
    setModalVisible(true);
  }

  async function save() {
    if (!name.trim()) { Alert.alert('Name is required'); return; }
    const db = await getDb();
    if (editing) {
      await db.runAsync(
        `UPDATE supplements SET name=?,brand=?,pills_per_bottle=?,price=?,type=?,unit=?,current_inventory=? WHERE id=?`,
        [name.trim(), brand.trim() || null, Number(pillsPerBottle), Number(price), type, unit, Number(inventory), editing.id],
      );
    } else {
      await db.runAsync(
        `INSERT INTO supplements (id,name,brand,pills_per_bottle,price,type,unit,current_inventory) VALUES (?,?,?,?,?,?,?,?)`,
        [uuid(), name.trim(), brand.trim() || null, Number(pillsPerBottle), Number(price), type, unit, Number(inventory)],
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
          const db = await getDb();
          await db.runAsync('DELETE FROM supplements WHERE id=?', [id]);
          loadSupplements();
        },
      },
    ]);
  }

  function renderItem({ item: s }: { item: Supplement }) {
    const unitLabel = s.unit === 'tablets' ? 'tabs' : s.unit === 'ml' ? 'ml' : s.unit === 'drops' ? 'drops' : 'caps';
    return (
      <Pressable
        onPress={() => openEdit(s)}
        className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-3"
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 min-w-0">
            <Text className="text-white font-semibold text-base">{s.name}</Text>
            <Text className="text-gray-500 text-xs mt-0.5">
              {s.brand ? `${s.brand} · ` : ''}{s.pills_per_bottle} {unitLabel}/bottle · ${Number(s.price).toFixed(2)}
            </Text>
          </View>
          <View className="items-end gap-1">
            <Text className="text-gray-400 text-sm font-mono">
              {Number(s.current_inventory)} {unitLabel}
            </Text>
            <View className={`px-2 py-0.5 rounded-full ${s.type === 'maintenance' ? 'bg-blue-900/40' : 'bg-amber-900/40'}`}>
              <Text className={`text-xs font-medium ${s.type === 'maintenance' ? 'text-blue-400' : 'text-amber-400'}`}>
                {s.type}
              </Text>
            </View>
          </View>
        </View>
        <Pressable
          onPress={() => deleteSupplement(s.id)}
          className="absolute top-3 right-3 p-1"
          hitSlop={8}
        >
          <Text className="text-gray-700 text-xs">✕</Text>
        </Pressable>
      </Pressable>
    );
  }

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
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-background px-5 pt-6">
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
              <TextInput className={inputCls} value={name} onChangeText={setName} placeholder="e.g. Magnesium Glycinate" placeholderTextColor="#4b5563" />
            </View>
            <View>
              <Text className={labelCls}>Brand</Text>
              <TextInput className={inputCls} value={brand} onChangeText={setBrand} placeholder="e.g. Thorne" placeholderTextColor="#4b5563" />
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Text className={labelCls}>Per bottle</Text>
                <TextInput className={inputCls} value={pillsPerBottle} onChangeText={setPillsPerBottle} keyboardType="numeric" />
              </View>
              <View className="flex-1">
                <Text className={labelCls}>Price ($)</Text>
                <TextInput className={inputCls} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#4b5563" />
              </View>
            </View>
            <View>
              <Text className={labelCls}>Inventory on hand</Text>
              <TextInput className={inputCls} value={inventory} onChangeText={setInventory} keyboardType="decimal-pad" />
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
          </View>

          <Pressable onPress={save} className="mt-8 bg-violet-600 rounded-xl py-3.5 items-center">
            <Text className="text-white font-semibold text-base">Save</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
