import './global.css';
import React, { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { getDb, uuid } from '@/db/database';
import { todayISO } from '@/utils/dates';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { initPrefs, loadPrefs } from '@/utils/prefs';
import RegimensScreen from '@/screens/RegimensScreen';
import SupplementsScreen from '@/screens/SupplementsScreen';
import SettingsScreen from '@/screens/SettingsScreen';
import '@/utils/notifications'; // registers setNotificationHandler at app startup
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { rem } from 'nativewind';

const Tab = createBottomTabNavigator();
const fontScaleMap: Record<string, number> = { small: 12, medium: 14, large: 16 };

function Navigation() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0b0d12' },
        headerTintColor: '#e2e6ef',
        headerTitleStyle: { fontWeight: '600' },
        headerStatusBarHeight: insets.top,
        tabBarStyle: {
          backgroundColor: '#0b0d12',
          borderTopColor: '#1a1d2a',
          paddingBottom: insets.bottom,
        },
        tabBarActiveTintColor: '#7c3aed',
        tabBarInactiveTintColor: '#4b5563',
      }}
    >
      <Tab.Screen
        name="Regimens"
        component={RegimensScreen}
        options={{
          title: 'Regimens',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📋</Text>,
        }}
      />
      <Tab.Screen
        name="Supplements"
        component={SupplementsScreen}
        options={{
          title: 'Supplements',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>💊</Text>,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⚙️</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    (async () => {
      await initPrefs();
      rem.set(fontScaleMap[loadPrefs().fontSize] ?? 14);
      setPrefsReady(true);
    })();
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const regimenId = response.notification.request.content.data?.regimenId as string | undefined;
      if (!regimenId) return;
      (async () => {
        try {
          const today = todayISO();
          const db = await getDb();
          await db.runAsync(
            `INSERT INTO dose_log (id, regimen_id, log_date, status)
             VALUES (?, ?, ?, 'taken')
             ON CONFLICT (regimen_id, log_date) DO UPDATE SET status = 'taken'`,
            [uuid(), regimenId, today],
          );
        } catch { /* non-critical */ }
      })();
    });
    return () => sub.remove();
  }, []);

  if (!prefsReady) return null;

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Navigation />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
