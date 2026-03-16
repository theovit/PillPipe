import './global.css';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import RegimensScreen from '@/screens/RegimensScreen';
import SupplementsScreen from '@/screens/SupplementsScreen';
import SettingsScreen from '@/screens/SettingsScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#0b0d12' },
          headerTintColor: '#e2e6ef',
          headerTitleStyle: { fontWeight: '600' },
          tabBarStyle: { backgroundColor: '#0b0d12', borderTopColor: '#1a1d2a' },
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
    </NavigationContainer>
  );
}
