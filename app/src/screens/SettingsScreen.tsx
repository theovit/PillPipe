import React from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { getDb } from '@/db/database';

export default function SettingsScreen() {
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
        <Text className="text-gray-600 text-xs mt-2">Offline-first · Local SQLite · No account required</Text>
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
