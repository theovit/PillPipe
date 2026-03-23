# Android Bug Fix Pass (Group A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four Android app bugs: safe area header obscured by status bar, hardware back button not dismissing modals, and date format preference not applied to the DateField component.

**Architecture:** Three targeted file edits — `App.tsx` (SafeAreaProvider wrapper), `RegimensScreen.tsx` (onRequestClose on all 6 modals), and `DateField.tsx` (formatDate on displayed value). No new packages, no DB changes.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript, react-native-safe-area-context (Expo transitive dep, already installed), NativeWind 4

---

## File Map

| File | Change |
|---|---|
| `app/App.tsx` | Add `SafeAreaProvider` wrapper around `NavigationContainer` |
| `app/src/screens/RegimensScreen.tsx` | Add `onRequestClose` to 6 Modal components |
| `app/src/components/DateField.tsx` | Import `formatDate`; apply to displayed value |

**Worktree:** `D:/GitHub/PillPipe/.worktrees/android-bugfix-pass` (branch `feature/android-bugfix-pass`)

**Verification command** (no test suite — use TypeScript check):
```bash
cd app && npx tsc --noEmit
```
Expected: same pre-existing errors as on master, no new errors.

---

## Task 1: Safe area — wrap NavigationContainer in SafeAreaProvider

**Files:**
- Modify: `app/App.tsx`

**Context:** `react-native-safe-area-context` is already installed as a transitive Expo dependency. No `npm install` needed. The `SafeAreaProvider` must wrap `NavigationContainer` so React Navigation can compute status bar insets and push headers below the system notification bar.

- [ ] **Step 1: Add the SafeAreaProvider import**

In `app/App.tsx`, add this import to the existing import block (after the last import on line 14):

```tsx
import { SafeAreaProvider } from 'react-native-safe-area-context';
```

- [ ] **Step 2: Wrap NavigationContainer**

Replace the entire `return (...)` block in `App.tsx`. Change from:

```tsx
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator
```

To:

```tsx
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Tab.Navigator
```

And update the closing tags. Change from:

```tsx
    </NavigationContainer>
  );
```

To:

```tsx
      </NavigationContainer>
    </SafeAreaProvider>
  );
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd app && npx tsc --noEmit
```

Expected: no new errors beyond the pre-existing set.

- [ ] **Step 4: Commit**

```bash
git add app/App.tsx
git commit -m "fix(app): wrap NavigationContainer in SafeAreaProvider to fix header safe area"
```

---

## Task 2: Hardware back button — add onRequestClose to all 6 modals

**Files:**
- Modify: `app/src/screens/RegimensScreen.tsx`

**Context:** On Android, pressing the hardware back button fires the `onRequestClose` callback on any visible `<Modal>`. Without it, the back button is silently swallowed and the modal stays open. Each modal's `onRequestClose` must call the same handler as its Cancel/Done button.

The 6 modals and their correct handlers are:

| Modal | Line | `onRequestClose` handler |
|---|---|---|
| New Session | 970 | `() => { setSessionModal(false); setSelectedTemplateId(''); }` ← two calls: resets template selection too |
| Edit Session | 1026 | `() => setEditModal(false)` |
| Shopping List | 1074 | `() => setShoppingListModal(false)` |
| Template Name | 1147 | `() => setTemplateModal(false)` |
| Add Regimen | 1178 | `() => setRegimenModal(false)` |
| Phase Editor | 1212 | `() => setPhaseModal(false)` |

- [ ] **Step 1: Update New Session Modal (line 970)**

Change:
```tsx
<Modal visible={sessionModal} animationType="slide" presentationStyle="pageSheet">
```
To:
```tsx
<Modal visible={sessionModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setSessionModal(false); setSelectedTemplateId(''); }}>
```

- [ ] **Step 2: Update Edit Session Modal (line 1026)**

Change:
```tsx
<Modal visible={editModal} animationType="slide" presentationStyle="pageSheet">
```
To:
```tsx
<Modal visible={editModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditModal(false)}>
```

- [ ] **Step 3: Update Shopping List Modal (line 1074)**

Change:
```tsx
<Modal visible={shoppingListModal} animationType="slide" presentationStyle="pageSheet">
```
To:
```tsx
<Modal visible={shoppingListModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShoppingListModal(false)}>
```

- [ ] **Step 4: Update Template Name Modal (line 1147)**

Change:
```tsx
<Modal visible={templateModal} animationType="fade" transparent>
```
To:
```tsx
<Modal visible={templateModal} animationType="fade" transparent onRequestClose={() => setTemplateModal(false)}>
```

- [ ] **Step 5: Update Add Regimen Modal (line 1178)**

Change:
```tsx
<Modal visible={regimenModal} animationType="slide" presentationStyle="pageSheet">
```
To:
```tsx
<Modal visible={regimenModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRegimenModal(false)}>
```

- [ ] **Step 6: Update Phase Editor Modal (line 1212)**

Change:
```tsx
<Modal visible={phaseModal} animationType="slide" presentationStyle="pageSheet">
```
To:
```tsx
<Modal visible={phaseModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPhaseModal(false)}>
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add app/src/screens/RegimensScreen.tsx
git commit -m "fix(app): add onRequestClose to all modals so hardware back button dismisses them"
```

---

## Task 3: Date format — apply formatDate in DateField

**Files:**
- Modify: `app/src/components/DateField.tsx`

**Context:** `DateField` renders its `value` prop (a raw `YYYY-MM-DD` ISO string) directly as text on line 53. The `formatDate` function in `app/src/utils/dates.ts` reads the user's date format preference internally and returns the correctly formatted string. It takes one argument: `formatDate(dateStr: string | null | undefined): string`. The fix is in the native branch only (lines 46–69); the web branch uses a `TextInput` that accepts typed YYYY-MM-DD input and should stay as-is.

- [ ] **Step 1: Add the formatDate import**

In `app/src/components/DateField.tsx`, add to the existing imports (after line 8):

```tsx
import { formatDate } from '@/utils/dates';
```

- [ ] **Step 2: Apply formatDate to the displayed value**

On line 53, change:
```tsx
          {value || placeholder}
```
To:
```tsx
          {value ? formatDate(value) : placeholder}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd app && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/DateField.tsx
git commit -m "fix(app): apply user date format preference in DateField display"
```

---

## Final Verification

After all three tasks:

- [ ] Rebuild and install on device:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio1/jbr"
export ANDROID_HOME="/c/Users/Andrew/AppData/Local/Android/Sdk"
export PATH="$PATH:/c/Users/Andrew/AppData/Local/Android/Sdk/platform-tools"
cd app && npx expo run:android --port 8082
```

- [ ] Manual checks on device:
  1. **Safe area:** Header fully visible below status bar in all 3 tabs. Cancel buttons tappable.
  2. **Back button:** Open each modal → press hardware back → modal dismisses cleanly.
  3. **Date format:** Set Settings → Date Format to DD/MM/YYYY. Open New Session modal → start date field shows `23/03/2026` format.
