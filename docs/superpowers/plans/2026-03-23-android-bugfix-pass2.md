# Android Bug Fix Pass 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four Android bugs — safe area header overlap, "Add to Session" button hidden behind nav bar, supplements back button, and date format preference not persisting.

**Architecture:** Three targeted file edits (App.tsx, RegimensScreen.tsx, SupplementsScreen.tsx) plus a conditional prefs migration if the localStorage diagnostic fails. No new packages needed unless the diagnostic reveals localStorage is broken on native.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript, react-native-safe-area-context (already installed)

---

## Worktree
`D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2` — branch `feature/android-bugfix-pass2`

## Verification command
```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2/app && npx tsc --noEmit 2>&1
```
Expected: same pre-existing errors as on master (RegimensScreen.tsx and SettingsScreen.tsx), no new errors.

---

## File Map

| File | Change |
|---|---|
| `app/App.tsx` | Extract `Navigation` inner component; use `useSafeAreaInsets` for explicit header and tab bar insets |
| `app/src/screens/RegimensScreen.tsx` | Add `useSafeAreaInsets`; apply bottom padding to Add Regimen modal root view |
| `app/src/screens/SupplementsScreen.tsx` | Add `onRequestClose` to supplement form Modal |
| `app/src/utils/prefs.ts` | (Conditional) Migrate to AsyncStorage cache if localStorage diagnostic fails |
| `app/App.tsx` | (Conditional) Call `initPrefs()` on mount if prefs migration was needed |

---

## Task 1: Safe area top — extract Navigation component with explicit insets

**Files:**
- Modify: `app/App.tsx` (full rewrite of return block and add Navigation component)

**Context:** Android 15 forces edge-to-edge mode. React Navigation's auto-detection of `headerStatusBarHeight` fails under this mode. The fix is to extract the Tab.Navigator into a child component called `Navigation` that can call `useSafeAreaInsets()` (a React hook that must be called inside `SafeAreaProvider`'s context). The `Navigation` component is rendered inside `NavigationContainer` which is inside `SafeAreaProvider`, so the hook works correctly.

**Current `app/App.tsx`** (for reference — read the file to verify before editing):
```tsx
// @atlas-entrypoint: App — root component
import './global.css';
import React, { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { getDb, uuid } from '@/db/database';
import { todayISO } from '@/utils/dates';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RegimensScreen from '@/screens/RegimensScreen';
import SupplementsScreen from '@/screens/SupplementsScreen';
import SettingsScreen from '@/screens/SettingsScreen';
import '@/utils/notifications'; // registers setNotificationHandler at app startup
```

- [ ] **Step 1: Update the SafeAreaProvider import to also import useSafeAreaInsets**

Change line 15:
```tsx
import { SafeAreaProvider } from 'react-native-safe-area-context';
```
To:
```tsx
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
```

- [ ] **Step 2: Add the Navigation component before the App function**

Insert this block after `const Tab = createBottomTabNavigator();` (line 17) and before `export default function App()`:

```tsx
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
```

- [ ] **Step 3: Replace the return block in App to use Navigation**

Replace the entire `return (...)` block in the `App` function (lines 40–81) with:

```tsx
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Navigation />
      </NavigationContainer>
    </SafeAreaProvider>
  );
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2/app && npx tsc --noEmit 2>&1
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2
git add app/App.tsx
git commit -m "fix(app): extract Navigation component with explicit useSafeAreaInsets for Android 15 edge-to-edge"
```

---

## Task 2: Safe area bottom — Add Regimen modal bottom padding

**Files:**
- Modify: `app/src/screens/RegimensScreen.tsx`

**Context:** The Add Regimen modal's root `<View>` has no bottom safe area padding. On Android gesture navigation (default on Pixel 8 Pro), the 48dp system nav bar covers the "Add to Session" button. Fix: use `useSafeAreaInsets` (already installed) inside `RegimensScreen` to get the bottom inset and apply it as padding to the modal root view.

- [ ] **Step 1: Add useSafeAreaInsets import to RegimensScreen.tsx**

There is no existing `react-native-safe-area-context` import in `RegimensScreen.tsx`. Add a new import line after the React Native imports block (after the last `import ... from 'react-native'` line, around line 18):

```tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context';
```

- [ ] **Step 2: Call useSafeAreaInsets in RegimensScreen**

Near the top of the `RegimensScreen` function body, after the existing `useState` declarations, add:
```tsx
const insets = useSafeAreaInsets();
```

- [ ] **Step 3: Add bottom padding to the Add Regimen modal root View**

Find the Add Regimen modal root View (currently at line ~1179):
```tsx
        <View className="flex-1 bg-background px-5 pt-6">
```

This is the View immediately inside:
```tsx
      <Modal visible={regimenModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRegimenModal(false)}>
```

Change it to:
```tsx
        <View className="flex-1 bg-background px-5 pt-6" style={{ paddingBottom: insets.bottom + 16 }}>
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2/app && npx tsc --noEmit 2>&1
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2
git add app/src/screens/RegimensScreen.tsx
git commit -m "fix(app): add bottom safe area padding to Add Regimen modal so button clears system nav bar"
```

---

## Task 3: Supplements modal — add onRequestClose

**Files:**
- Modify: `app/src/screens/SupplementsScreen.tsx`

**Context:** The supplement form Modal (line 215) has no `onRequestClose`. The hardware back button is silently swallowed and the modal stays open.

- [ ] **Step 1: Add onRequestClose to the supplements Modal**

Find line ~215:
```tsx
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
```

Change to:
```tsx
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
```

`setModalVisible(false)` matches the Cancel button handler on line ~221.

- [ ] **Step 2: Verify TypeScript**

```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2/app && npx tsc --noEmit 2>&1
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2
git add app/src/screens/SupplementsScreen.tsx
git commit -m "fix(app): add onRequestClose to supplements modal for hardware back button"
```

---

## Task 4: Prefs persistence — diagnose and fix if needed

**Files (conditional):**
- Modify: `app/src/utils/prefs.ts` (only if diagnostic fails)
- Modify: `app/App.tsx` (only if diagnostic fails)

**Context:** `prefs.ts` uses `globalThis.localStorage` which is polyfilled by Expo. The comment says "works on React Native via Expo's global localStorage polyfill." This task verifies that claim and migrates to AsyncStorage only if the polyfill is broken.

### Step 4a: Run the diagnostic

- [ ] **Step 1: Add a diagnostic log to SettingsScreen**

In `app/src/screens/SettingsScreen.tsx`, find the `useEffect` that loads prefs (around line 20-30). Add a temporary console.log to test round-tripping:

```tsx
useEffect(() => {
  // DIAGNOSTIC: verify prefs round-trip
  const { savePrefs, loadPrefs } = require('@/utils/prefs');
  savePrefs({ dateFormat: 'YYYY-MM-DD' });
  const result = loadPrefs();
  console.log('[prefs diagnostic] dateFormat after save:', result.dateFormat);
  // ... rest of existing useEffect
```

- [ ] **Step 2: Build and check logs**

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio1/jbr"
export ANDROID_HOME="/c/Users/Andrew/AppData/Local/Android/Sdk"
export PATH="$PATH:/c/Users/Andrew/AppData/Local/Android/Sdk/platform-tools"
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2/app && npx expo run:android --port 8082 2>&1
```

Then check Metro logs for `[prefs diagnostic]`.

- **If log shows `YYYY-MM-DD`** → localStorage works. Remove the diagnostic log. No migration needed. Skip to Step 4b → Commit.
- **If log shows `MM/DD/YYYY` (default)** → localStorage is broken. Continue to Step 4c → Migration.

- [ ] **Step 3: Remove the diagnostic log** (always do this regardless of result)

Remove the console.log lines added in Step 1.

### Step 4b: If localStorage works — commit and done

- [ ] **Commit the removed diagnostic (no other changes):**

```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2
git add app/src/screens/SettingsScreen.tsx
git commit -m "chore(app): verify prefs localStorage round-trip (working, no migration needed)"
```

Skip Task 4c entirely.

### Step 4c: If localStorage is broken — migrate to AsyncStorage

- [ ] **Step 1: Install AsyncStorage**

```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2/app
npx expo install @react-native-async-storage/async-storage
```

- [ ] **Step 2: Rewrite prefs.ts with AsyncStorage + module-level cache**

Replace the entire contents of `app/src/utils/prefs.ts` with:

```ts
/**
 * Shared preferences — synchronous reads via module-level cache,
 * async persistence via AsyncStorage.
 * Call initPrefs() once at app startup before rendering screens.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AccentColor = 'violet' | 'red' | 'orange' | 'amber' | 'green' | 'blue';

export interface AppPrefs {
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  accentColor: AccentColor;
}

const KEY = 'pillpipe_prefs';

const DEFAULT: AppPrefs = { dateFormat: 'MM/DD/YYYY', accentColor: 'violet' };

export const ACCENT_HEX: Record<AccentColor, string> = {
  violet: '#7c3aed',
  red:    '#dc2626',
  orange: '#ea580c',
  amber:  '#d97706',
  green:  '#16a34a',
  blue:   '#2563eb',
};

// Module-level cache — populated by initPrefs() at app startup.
// Synchronous reads via loadPrefs() always return from this cache.
let _cache: AppPrefs = { ...DEFAULT };

/** Load persisted prefs from AsyncStorage into the module cache. Call once at app startup. */
export async function initPrefs(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) _cache = { ...DEFAULT, ...JSON.parse(raw) };
  } catch { /* no-op — use defaults */ }
}

/** Synchronous read from the module cache. Always up-to-date after initPrefs() resolves. */
export function loadPrefs(): AppPrefs {
  return { ..._cache };
}

/** Update the cache and persist asynchronously (fire-and-forget). */
export function savePrefs(patch: Partial<AppPrefs>): void {
  _cache = { ..._cache, ...patch };
  AsyncStorage.setItem(KEY, JSON.stringify(_cache)).catch(() => { /* no-op */ });
}

/** Returns a React Native style object for the current accent color background. */
export function accentBg(): { backgroundColor: string } {
  return { backgroundColor: ACCENT_HEX[_cache.accentColor] };
}
```

- [ ] **Step 3: Call initPrefs() in App.tsx on mount with loading gate**

`initPrefs()` is async. Screens must not render before it resolves, otherwise they read stale default prefs from the cache. Add a `prefsReady` gate that renders `null` until init completes.

In `app/App.tsx`, add this import after the existing imports:
```tsx
import { initPrefs } from '@/utils/prefs';
```

In the `App` component, add a `useState` for the loading gate and a `useEffect` that awaits init (add before the existing notification `useEffect`):
```tsx
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    (async () => {
      await initPrefs();
      setPrefsReady(true);
    })();
  }, []);

  if (!prefsReady) return null;
```

The `if (!prefsReady) return null;` must be placed **after all hooks** but **before the return block** that renders `<SafeAreaProvider>`. This blocks navigation from mounting until prefs are loaded (typically <20ms — imperceptible to users).

- [ ] **Step 4: Verify TypeScript**

```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2/app && npx tsc --noEmit 2>&1
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2
git add app/src/utils/prefs.ts app/App.tsx app/package.json app/package-lock.json
git commit -m "fix(app): migrate prefs to AsyncStorage with synchronous module cache"
```

---

## Final Verification

After all tasks:

- [ ] TypeScript clean: `cd app && npx tsc --noEmit`
- [ ] Rebuild on device:
```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio1/jbr"
export ANDROID_HOME="/c/Users/Andrew/AppData/Local/Android/Sdk"
export PATH="$PATH:/c/Users/Andrew/AppData/Local/Android/Sdk/platform-tools"
cd D:/GitHub/PillPipe/.worktrees/android-bugfix-pass2/app && npx expo run:android --port 8082
```

Manual checks:
1. **Safe area top**: Header fully below status bar in all 3 tabs. Cancel buttons visible and tappable.
2. **Safe area bottom**: Open Add Regimen modal. "Add to Session" button visible above system nav bar. Tap it — regimen added.
3. **Supplements back**: Open supplement form. Hardware back dismisses it.
4. **Date format**: Set DD/MM/YYYY in Settings. Navigate to Regimens. Dates show `23/03/2026` not `2026-03-23`. Force-close app, reopen — format still DD/MM/YYYY.
