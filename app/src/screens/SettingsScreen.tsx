import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { getDb } from '@/db/database';
import { ACCENT_HEX, AccentColor, AppPrefs, loadPrefs, savePrefs } from '@/utils/prefs';
import appJson from '../../app.json';

const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const;
const ACCENT_COLORS: AccentColor[] = ['violet', 'red', 'orange', 'amber', 'green', 'blue'];

export default function SettingsScreen() {
  const [dateFormat, setDateFormat] = useState<AppPrefs['dateFormat']>('MM/DD/YYYY');
  const [accentColor, setAccentColor] = useState<AccentColor>('violet');
  const [notifStatus, setNotifStatus] = useState<string>('unknown');
  const [backupWorking, setBackupWorking] = useState(false);
  const [restoreWorking, setRestoreWorking] = useState(false);

  useEffect(() => {
    const prefs = loadPrefs();
    setDateFormat(prefs.dateFormat);
    setAccentColor(prefs.accentColor);
    Notifications.getPermissionsAsync()
      .then((s) => setNotifStatus(s.status))
      .catch(() => setNotifStatus('unavailable'));
  }, []);

  function applyDateFormat(fmt: AppPrefs['dateFormat']) {
    setDateFormat(fmt);
    savePrefs({ dateFormat: fmt });
  }

  function applyAccentColor(c: AccentColor) {
    setAccentColor(c);
    savePrefs({ accentColor: c });
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

  async function exportBackup() {
    setBackupWorking(true);
    try {
      const db = await getDb();
      const [supplements, sessions, regimens, phases, doseLogs] = await Promise.all([
        db.getAllAsync('SELECT * FROM supplements'),
        db.getAllAsync('SELECT * FROM sessions'),
        db.getAllAsync('SELECT * FROM regimens'),
        db.getAllAsync('SELECT * FROM phases'),
        db.getAllAsync('SELECT * FROM dose_log'),
      ]);
      const backup = {
        version: 1,
        exported_at: new Date().toISOString(),
        supplements, sessions, regimens, phases, dose_log: doseLogs,
      };
      const json = JSON.stringify(backup, null, 2);
      const date = new Date().toISOString().slice(0, 10);
      const path = `${FileSystem.cacheDirectory}pillpipe-backup-${date}.json`;
      await FileSystem.writeAsStringAsync(path, json);
      await Sharing.shareAsync(path, { mimeType: 'application/json', UTI: 'public.json' });
    } catch (e) {
      Alert.alert('Backup failed', String(e));
    }
    setBackupWorking(false);
  }

  async function importBackup() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const json = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const data = JSON.parse(json);

      if (!data.supplements || !data.sessions) {
        Alert.alert('Invalid backup', 'This file does not look like a PillPipe backup.');
        return;
      }

      Alert.alert(
        'Restore backup?',
        `This will replace all current data with the backup from ${data.exported_at?.slice(0, 10) ?? 'unknown date'}. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore', style: 'destructive', onPress: async () => {
              setRestoreWorking(true);
              try {
                const db = await getDb();
                await db.withExclusiveTransactionAsync(async (txn) => {
                  await txn.runAsync('DELETE FROM dose_log');
                  await txn.runAsync('DELETE FROM phases');
                  await txn.runAsync('DELETE FROM regimens');
                  await txn.runAsync('DELETE FROM sessions');
                  await txn.runAsync('DELETE FROM supplements');

                  for (const row of (data.supplements ?? [])) {
                    const keys = Object.keys(row).join(',');
                    const placeholders = Object.keys(row).map(() => '?').join(',');
                    await txn.runAsync(
                      `INSERT OR IGNORE INTO supplements (${keys}) VALUES (${placeholders})`,
                      Object.values(row) as any[],
                    );
                  }
                  for (const row of (data.sessions ?? [])) {
                    const keys = Object.keys(row).join(',');
                    const placeholders = Object.keys(row).map(() => '?').join(',');
                    await txn.runAsync(
                      `INSERT OR IGNORE INTO sessions (${keys}) VALUES (${placeholders})`,
                      Object.values(row) as any[],
                    );
                  }
                  for (const row of (data.regimens ?? [])) {
                    const keys = Object.keys(row).join(',');
                    const placeholders = Object.keys(row).map(() => '?').join(',');
                    await txn.runAsync(
                      `INSERT OR IGNORE INTO regimens (${keys}) VALUES (${placeholders})`,
                      Object.values(row) as any[],
                    );
                  }
                  for (const row of (data.phases ?? [])) {
                    const keys = Object.keys(row).join(',');
                    const placeholders = Object.keys(row).map(() => '?').join(',');
                    await txn.runAsync(
                      `INSERT OR IGNORE INTO phases (${keys}) VALUES (${placeholders})`,
                      Object.values(row) as any[],
                    );
                  }
                  for (const row of (data.dose_log ?? [])) {
                    const keys = Object.keys(row).join(',');
                    const placeholders = Object.keys(row).map(() => '?').join(',');
                    await txn.runAsync(
                      `INSERT OR IGNORE INTO dose_log (${keys}) VALUES (${placeholders})`,
                      Object.values(row) as any[],
                    );
                  }
                });
                Alert.alert('Restored', 'Backup restored successfully. Navigate to Regimens to see your data.');
              } catch (e) {
                Alert.alert('Restore failed', String(e));
              }
              setRestoreWorking(false);
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert('Error', String(e));
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

      {/* Accent color */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Accent Color</Text>
        <View className="flex-row gap-3 flex-wrap">
          {ACCENT_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => applyAccentColor(c)}
              style={{ backgroundColor: ACCENT_HEX[c] }}
              className={`w-9 h-9 rounded-full items-center justify-center ${accentColor === c ? 'border-2 border-white' : ''}`}
            >
              {accentColor === c && <Text className="text-white font-bold text-xs">✓</Text>}
            </Pressable>
          ))}
        </View>
        <Text className="text-gray-600 text-xs mt-2">Takes effect on next app launch</Text>
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

      {/* Backup & Restore */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Backup & Restore</Text>
        <Pressable
          onPress={exportBackup}
          disabled={backupWorking}
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 mb-2"
        >
          <Text className="text-gray-200 text-sm font-medium">
            {backupWorking ? 'Exporting…' : '↑ Export backup (JSON)'}
          </Text>
          <Text className="text-gray-600 text-xs mt-0.5">Saves all data to a shareable file</Text>
        </Pressable>
        <Pressable
          onPress={importBackup}
          disabled={restoreWorking}
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3"
        >
          <Text className="text-gray-200 text-sm font-medium">
            {restoreWorking ? 'Restoring…' : '↓ Restore from backup'}
          </Text>
          <Text className="text-gray-600 text-xs mt-0.5">Replaces all current data with a backup file</Text>
        </Pressable>
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
