import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getDb } from '@/db/database';
import appJson from '../../app.json';

const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const;
type DateFormat = typeof DATE_FORMATS[number];

const PREF_KEY = 'pillpipe_prefs';

function loadPrefs(): { dateFormat: DateFormat } {
  try {
    const raw = (globalThis as any).localStorage?.getItem?.(PREF_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* no-op */ }
  return { dateFormat: 'MM/DD/YYYY' };
}

function savePrefs(prefs: { dateFormat: DateFormat }) {
  try { (globalThis as any).localStorage?.setItem?.(PREF_KEY, JSON.stringify(prefs)); } catch { /* no-op */ }
}

export default function SettingsScreen() {
  const [dateFormat, setDateFormat] = useState<DateFormat>('MM/DD/YYYY');
  const [notifStatus, setNotifStatus] = useState<string>('unknown');

  useEffect(() => {
    const prefs = loadPrefs();
    setDateFormat(prefs.dateFormat);
    Notifications.getPermissionsAsync()
      .then((s) => setNotifStatus(s.status))
      .catch(() => setNotifStatus('unavailable'));
  }, []);

  function applyDateFormat(fmt: DateFormat) {
    setDateFormat(fmt);
    savePrefs({ dateFormat: fmt });
  }

  async function requestNotifications() {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotifStatus(status);
      if (status === 'granted') {
        Alert.alert('Notifications enabled', 'Reminder times set on regimens will fire daily.');
      } else {
        Alert.alert('Permission denied', 'Enable notifications in your device settings.');
      }
    } catch {
      Alert.alert('Error', 'Notifications are not available on this platform.');
    }
  }

  async function clearAllData() {
    Alert.alert(
      'Clear all data?',
      'This will permanently delete all supplements, sessions, regimens, and phases.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear', style: 'destructive', onPress: async () => {
            const db = await getDb();
            await db.execAsync(`
              DELETE FROM dose_log;
              DELETE FROM phases;
              DELETE FROM regimens;
              DELETE FROM sessions;
              DELETE FROM supplements;
            `);
            Alert.alert('Cleared', 'All data has been deleted.');
          },
        },
      ],
    );
  }

  const version: string = (appJson as any).expo.version;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-4 pb-8">
      {/* About */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">About</Text>
        <View className="flex-row items-center gap-3 mb-2">
          <Text className="text-3xl">💊</Text>
          <View>
            <Text className="text-white font-semibold text-lg">PillPipe</Text>
            <Text className="text-gray-500 text-xs">Supplement inventory & shortfall tracking</Text>
          </View>
        </View>
        <Text className="text-gray-600 text-xs mt-2">
          Version {version} · Offline-first · Local SQLite · No account required
        </Text>
      </View>

      {/* Date format */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Date Format</Text>
        <View className="flex-row gap-2 flex-wrap">
          {DATE_FORMATS.map((fmt) => (
            <Pressable
              key={fmt}
              onPress={() => applyDateFormat(fmt)}
              className={`px-4 py-2 rounded-lg border ${
                dateFormat === fmt ? 'bg-violet-600 border-violet-500' : 'bg-gray-800 border-gray-700'
              }`}
            >
              <Text className={`text-sm font-medium ${dateFormat === fmt ? 'text-white' : 'text-gray-400'}`}>
                {fmt}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Notifications */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Notifications</Text>
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-gray-300 text-sm">Permission status</Text>
          <Text className={`text-sm font-medium ${notifStatus === 'granted' ? 'text-green-400' : 'text-gray-500'}`}>
            {notifStatus}
          </Text>
        </View>
        {notifStatus !== 'granted' ? (
          <Pressable onPress={requestNotifications} className="bg-violet-600 rounded-lg px-4 py-2.5 items-center">
            <Text className="text-white text-sm font-medium">Enable Notifications</Text>
          </Pressable>
        ) : (
          <Text className="text-gray-600 text-xs">Reminders fire at the time set on each regimen card.</Text>
        )}
      </View>

      {/* Data */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Data</Text>
        <Pressable
          onPress={clearAllData}
          className="bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-3"
        >
          <Text className="text-red-400 text-sm font-medium">Clear all data</Text>
          <Text className="text-gray-600 text-xs mt-0.5">Permanently deletes everything on this device</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
