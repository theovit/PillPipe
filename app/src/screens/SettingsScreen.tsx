// @atlas-entrypoint: App — substantial file
import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { getDb } from '@/db/database';
import { ACCENT_HEX, AccentColor, AppPrefs, FontSize, loadPrefs, savePrefs } from '@/utils/prefs';
import { rem } from 'nativewind';
import appJson from '../../app.json';

const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const;
const ACCENT_COLORS: AccentColor[] = ['violet', 'red', 'orange', 'amber', 'green', 'blue'];

const fontScaleMap: Record<FontSize, number> = { small: 12, medium: 14, large: 16 };

function SectionHeader({ title, open, onPress }: { title: string; open: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center justify-between px-4 py-3">
      <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider">{title}</Text>
      <Text className="text-gray-600 text-xs">{open ? '▲' : '▼'}</Text>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const [dateFormat, setDateFormat] = useState<AppPrefs['dateFormat']>('MM/DD/YYYY');
  const [accentColor, setAccentColor] = useState<AccentColor>('violet');
  const [notifStatus, setNotifStatus] = useState<string>('unknown');
  const [backupWorking, setBackupWorking] = useState(false);
  const [restoreWorking, setRestoreWorking] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; created_at: string }[]>([]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [defaultDuration, setDefaultDuration] = useState<AppPrefs['defaultDuration']>(0);
  const [showTimePicker, setShowTimePicker] = useState<'morning' | 'lunch' | 'dinner' | null>(null);
  const [morningTime, setMorningTime] = useState<string>('08:00');
  const [lunchTime, setLunchTime] = useState<string>('12:00');
  const [dinnerTime, setDinnerTime] = useState<string>('18:00');

  function toggleSection(name: string) {
    setOpenSections(p => ({ ...p, [name]: !p[name] }));
  }

  useEffect(() => {
    const prefs = loadPrefs();
    setDateFormat(prefs.dateFormat);
    setAccentColor(prefs.accentColor);
    setFontSize(prefs.fontSize);
    setDefaultDuration(prefs.defaultDuration);
    setMorningTime(prefs.morningTime);
    setLunchTime(prefs.lunchTime);
    setDinnerTime(prefs.dinnerTime);
    Notifications.getPermissionsAsync()
      .then((s) => setNotifStatus(s.status))
      .catch(() => setNotifStatus('unavailable'));
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<{ id: string; name: string; created_at: string }>(
        'SELECT id, name, created_at FROM session_templates ORDER BY created_at DESC',
      );
      setTemplates(rows);
    } catch { /* no-op */ }
  }

  async function deleteTemplate(id: string) {
    Alert.alert('Delete template?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const db = await getDb();
          await db.runAsync('DELETE FROM session_templates WHERE id=?', [id]);
          loadTemplates();
        },
      },
    ]);
  }

  function applyDateFormat(fmt: AppPrefs['dateFormat']) {
    setDateFormat(fmt);
    savePrefs({ dateFormat: fmt });
  }

  function applyAccentColor(c: AccentColor) {
    setAccentColor(c);
    savePrefs({ accentColor: c });
  }

  function applyFontSize(size: FontSize) {
    setFontSize(size);
    savePrefs({ fontSize: size });
    rem.set(fontScaleMap[size]);
  }

  function applyDefaultDuration(duration: AppPrefs['defaultDuration']) {
    setDefaultDuration(duration);
    savePrefs({ defaultDuration: duration });
  }

  function applyPresetTime(type: 'morning' | 'lunch' | 'dinner', time: string) {
    if (type === 'morning') setMorningTime(time);
    else if (type === 'lunch') setLunchTime(time);
    else setDinnerTime(time);
    savePrefs({ [`${type}Time`]: time } as any);
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
            try {
              const db = await getDb();
              await db.execAsync('DELETE FROM dose_log;');
              await db.execAsync('DELETE FROM phases;');
              await db.execAsync('DELETE FROM regimens;');
              await db.execAsync('DELETE FROM sessions;');
              await db.execAsync('DELETE FROM supplements;');
              Alert.alert('Cleared', 'All data has been deleted.');
            } catch (e) {
              Alert.alert('Error', 'Could not clear data: ' + String(e));
            }
          },
        },
      ],
    );
  }

  async function sendTestNotification() {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Notifications not enabled', 'Tap "Enable Notifications" first.');
        return;
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'PillPipe',
          body: 'Test notification — reminders are working!',
        },
        trigger: null,
      });
      Alert.alert('Sent', 'Check your notification tray.');
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  }

  const version: string = (appJson as any).expo.version;

  const DURATIONS: Array<{ key: AppPrefs['defaultDuration']; label: string }> = [
    { key: 0,   label: 'None'     },
    { key: 30,  label: '30 days'  },
    { key: 60,  label: '60 days'  },
    { key: 90,  label: '90 days'  },
    { key: 120, label: '120 days' },
  ];

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-4 pt-4 pb-8">

      {/* ── About ── */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl mb-4 overflow-hidden">
        <SectionHeader title="About" open={!!openSections.about} onPress={() => toggleSection('about')} />
        {openSections.about && (
          <View className="px-4 pb-4 border-t border-gray-800">
            <View className="flex-row items-center gap-3 mt-3 mb-2">
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
        )}
      </View>

      {/* ── Appearance ── */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl mb-4 overflow-hidden">
        <SectionHeader title="Appearance" open={!!openSections.appearance} onPress={() => toggleSection('appearance')} />
        {openSections.appearance && (
          <View className="px-4 pb-4 border-t border-gray-800">
            <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider mt-3 mb-2">Accent Color</Text>
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
        )}
      </View>

      {/* ── Preferences ── */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl mb-4 overflow-hidden">
        <SectionHeader title="Preferences" open={!!openSections.preferences} onPress={() => toggleSection('preferences')} />
        {openSections.preferences && (
          <View className="px-4 pb-4 border-t border-gray-800 gap-5">
            {/* Date format */}
            <View className="mt-3">
              <Text className="text-gray-300 text-sm font-medium mb-2">Date Format</Text>
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

            {/* Default session duration */}
            <View>
              <Text className="text-gray-300 text-sm font-medium mb-1">Default Session Duration</Text>
              <Text className="text-gray-500 text-xs mb-2">Pre-fills the target date when creating a new session.</Text>
              <View className="flex-row gap-2 flex-wrap">
                {DURATIONS.map(({ key, label }) => (
                  <Pressable
                    key={key}
                    onPress={() => applyDefaultDuration(key)}
                    className={`px-4 py-2 rounded-lg border ${
                      defaultDuration === key ? 'bg-violet-600 border-violet-500' : 'bg-gray-800 border-gray-700'
                    }`}
                  >
                    <Text className={`text-sm font-medium ${defaultDuration === key ? 'text-white' : 'text-gray-400'}`}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Font size */}
            <View>
              <Text className="text-gray-300 text-sm font-medium mb-2">Font Size</Text>
              <View className="flex-row gap-2">
                {(['small', 'medium', 'large'] as FontSize[]).map((size) => (
                  <Pressable
                    key={size}
                    onPress={() => applyFontSize(size)}
                    className={`px-4 py-2 rounded-lg border ${
                      fontSize === size ? 'bg-violet-600 border-violet-500' : 'bg-gray-800 border-gray-700'
                    }`}
                  >
                    <Text className={`text-sm font-medium capitalize ${fontSize === size ? 'text-white' : 'text-gray-400'}`}>
                      {size}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text className="text-gray-600 text-xs mt-2">Takes effect after restarting the app.</Text>
            </View>
          </View>
        )}
      </View>

      {/* ── Templates ── */}
      {templates.length > 0 && (
        <View className="bg-gray-900 border border-gray-800 rounded-xl mb-4 overflow-hidden">
          <SectionHeader title="Templates" open={!!openSections.templates} onPress={() => toggleSection('templates')} />
          {openSections.templates && (
            <View className="px-4 pb-4 border-t border-gray-800">
              {templates.map((t) => (
                <View key={t.id} className="flex-row items-center justify-between py-2 border-b border-gray-800 last:border-b-0 mt-2">
                  <View className="flex-1 mr-3">
                    <Text className="text-gray-200 text-sm font-medium">{t.name}</Text>
                    <Text className="text-gray-600 text-xs">{t.created_at.slice(0, 10)}</Text>
                  </View>
                  <Pressable onPress={() => deleteTemplate(t.id)} hitSlop={8}>
                    <Text className="text-red-400 text-sm">Delete</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* ── Notifications ── */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl mb-4 overflow-hidden">
        <SectionHeader title="Notifications" open={!!openSections.notifications} onPress={() => toggleSection('notifications')} />
        {openSections.notifications && (
          <View className="px-4 pb-4 border-t border-gray-800">
            <View className="flex-row items-center justify-between mt-3 mb-3">
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
              <View className="gap-2">
                <Text className="text-gray-600 text-xs mt-1 mb-2">
                  Set default times for Morning, Lunch, and Dinner reminders.
                  Changes apply on next app open.
                </Text>
                {(['morning', 'lunch', 'dinner'] as const).map((type) => {
                  const label = type.charAt(0).toUpperCase() + type.slice(1);
                  const time = type === 'morning' ? morningTime : type === 'lunch' ? lunchTime : dinnerTime;
                  return (
                    <Pressable
                      key={type}
                      onPress={() => setShowTimePicker(type)}
                      className="flex-row items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-4 py-3"
                    >
                      <Text className="text-gray-300 text-sm font-medium">{label}</Text>
                      <Text className="text-violet-400 text-sm font-mono">{time}</Text>
                    </Pressable>
                  );
                })}
                {showTimePicker && (
                  <DateTimePicker
                    value={(() => {
                      const t = showTimePicker === 'morning' ? morningTime : showTimePicker === 'lunch' ? lunchTime : dinnerTime;
                      return new Date(`1970-01-01T${t}:00`);
                    })()}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(_, date) => {
                      setShowTimePicker(null);
                      if (date) {
                        const hh = String(date.getHours()).padStart(2, '0');
                        const mm = String(date.getMinutes()).padStart(2, '0');
                        applyPresetTime(showTimePicker!, `${hh}:${mm}`);
                      }
                    }}
                  />
                )}
                <Pressable onPress={sendTestNotification} className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 items-center mt-1">
                  <Text className="text-gray-300 text-sm font-medium">Send Test Notification</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>

      {/* ── Backup & Restore ── */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl mb-4 overflow-hidden">
        <SectionHeader title="Backup & Restore" open={!!openSections.backup} onPress={() => toggleSection('backup')} />
        {openSections.backup && (
          <View className="px-4 pb-4 border-t border-gray-800 gap-2 mt-3">
            <Pressable
              onPress={exportBackup}
              disabled={backupWorking}
              className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3"
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
        )}
      </View>

      {/* ── Data ── */}
      <View className="bg-gray-900 border border-gray-800 rounded-xl mb-4 overflow-hidden">
        <SectionHeader title="Data" open={!!openSections.data} onPress={() => toggleSection('data')} />
        {openSections.data && (
          <View className="px-4 pb-4 border-t border-gray-800 mt-3">
            <Pressable
              onPress={clearAllData}
              className="bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-3"
            >
              <Text className="text-red-400 text-sm font-medium">Clear all data</Text>
              <Text className="text-gray-600 text-xs mt-0.5">Permanently deletes everything on this device</Text>
            </Pressable>
          </View>
        )}
      </View>

    </ScrollView>
  );
}
