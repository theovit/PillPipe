# Design: Android App — Bug Fix Pass 2

**Date:** 2026-03-23
**Scope:** `app/` only
**Status:** Approved

---

## Context

Four bugs remain after Bug Fix Pass 1. Bugs 1–2 are caused by Android 15 forcing edge-to-edge mode, which breaks safe area automatic detection. Bug 3 is a missed `onRequestClose`. Bug 4 is a prefs persistence issue that may silently fail on native.

---

## Bug 1 — Safe area top: header overlaps system notification bar

**Root cause:** Android 15 (Pixel 8 Pro) forces all apps into edge-to-edge mode. React Navigation's automatic `headerStatusBarHeight` detection fails under this mode — it reads the status bar height before Android has fully reported window insets, returning 0. Although `SafeAreaProvider` has correct inset values, the Tab.Navigator is constructed before those values propagate through React Navigation's internal header sizing.

**Fix:** Extract the tab navigator into an inner `Navigation` component declared inside `App` (but rendered as a child of `SafeAreaProvider`). Inside that component, call `useSafeAreaInsets()` and explicitly set `headerStatusBarHeight: insets.top` and `tabBarStyle: { ..., paddingBottom: insets.bottom }` in `screenOptions`. This bypasses the broken auto-detection and pins the header below the status bar.

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
      {/* same screens as before */}
    </Tab.Navigator>
  );
}

export default function App() {
  // ... existing useEffect ...
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Navigation />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
```

**Files affected:** `app/App.tsx`

**Validation:** On Pixel 8 Pro, header must be fully visible below the status bar in all three tabs. Cancel buttons in navigation headers must be tappable.

---

## Bug 2 — Safe area bottom: "Add to Session" button hidden behind system nav bar

**Root cause:** The Add Regimen modal's root `<View>` has no bottom inset. On Android gesture navigation (default on Pixel 8 Pro), the system nav bar is ~48dp tall and renders on top of the button. Users cannot tap "Add to Session."

**Fix:** In `RegimensScreen.tsx`, import `useSafeAreaInsets` from `react-native-safe-area-context`. Inside the `RegimensScreen` component, call `const insets = useSafeAreaInsets()`. In the Add Regimen modal's root `<View>`, add `style={{ paddingBottom: insets.bottom + 16 }}` alongside the existing NativeWind classes.

The Add Regimen modal root is currently:
```tsx
<Modal visible={regimenModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRegimenModal(false)}>
  <View className="flex-1 bg-background px-5 pt-6">
```

Change to:
```tsx
<Modal visible={regimenModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRegimenModal(false)}>
  <View className="flex-1 bg-background px-5 pt-6" style={{ paddingBottom: insets.bottom + 16 }}>
```

**Files affected:** `app/src/screens/RegimensScreen.tsx`

**Validation:** With system gesture navigation on, open the Add Regimen modal. The "Add to Session" button must be fully visible above the gesture handle area and tappable.

---

## Bug 3 — Supplements modal missing onRequestClose

**Root cause:** `SupplementsScreen.tsx` line 215 — the supplement form `<Modal>` has no `onRequestClose`. Hardware back button is silently swallowed; modal stays open.

**Fix:**
```tsx
// Before:
<Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">

// After:
<Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
```

`setModalVisible(false)` matches the existing Cancel button handler on line 221.

**Files affected:** `app/src/screens/SupplementsScreen.tsx`

**Validation:** Open the supplement form. Press hardware back. Modal must dismiss.

---

## Bug 4 — Date format preference may not persist on native

**Root cause:** `prefs.ts` uses `localStorage` via a silent-fallback helper:
```ts
function ls() {
  try { return localStorage; } catch { return null; }
}
```
If `localStorage` is unavailable in the React Native runtime (the `try/catch` suggests this was anticipated), `savePrefs` silently no-ops and `loadPrefs` always returns the default. The Settings UI appears to respond (local state updates), but nothing persists across app restarts.

**Fix:** Add a diagnostic first — call `savePrefs({ dateFormat: 'YYYY-MM-DD' })` and immediately `loadPrefs()` and verify the value round-trips. If it does NOT round-trip, migrate `prefs.ts` to use `@react-native-async-storage/async-storage` with a module-level synchronous cache:

```ts
// Module-level cache — populated at app startup
let _cache: AppPrefs = DEFAULT_PREFS;

export function loadPrefs(): AppPrefs { return _cache; }

export async function initPrefs(): Promise<void> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw) _cache = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
}

export function savePrefs(patch: Partial<AppPrefs>): void {
  _cache = { ..._cache, ...patch };
  AsyncStorage.setItem(KEY, JSON.stringify(_cache)); // fire-and-forget
}
```

`initPrefs()` is called once in `App.tsx` inside a `useEffect` on mount. After it resolves, all screens calling `loadPrefs()` get the correct values from the in-memory cache. `formatDate` continues to call `loadPrefs()` synchronously and works correctly.

If `localStorage` DOES round-trip correctly (no migration needed), no change is required for this bug.

**Files affected (if migration needed):** `app/src/utils/prefs.ts`, `app/App.tsx`

**Validation:** Set date format to DD/MM/YYYY. Force-close app. Reopen. Navigate to Settings — DD/MM/YYYY must still be selected. Navigate to Regimens — dates must display in DD/MM/YYYY format.

---

## Files Changed

| File | Change |
|---|---|
| `app/App.tsx` | Extract `Navigation` inner component; use `useSafeAreaInsets` for explicit `headerStatusBarHeight` and tab bar bottom padding |
| `app/src/screens/RegimensScreen.tsx` | Add `useSafeAreaInsets`; apply bottom padding to Add Regimen modal root view |
| `app/src/screens/SupplementsScreen.tsx` | Add `onRequestClose` to supplement form Modal |
| `app/src/utils/prefs.ts` | (Conditional) Migrate to AsyncStorage with module-level cache if localStorage fails |
| `app/App.tsx` | (Conditional) Call `initPrefs()` on mount if prefs migration needed |

---

## Out of Scope

- Settings overhaul (Group B — separate spec)
- Theming (Group C — separate spec)
- Backup infrastructure (Group D — separate spec)
- iOS-specific behavior
