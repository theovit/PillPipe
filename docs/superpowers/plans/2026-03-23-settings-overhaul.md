# Settings Overhaul (Group B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add collapsible Settings sections, a default session duration preference, and a font size selector to the Android app.

**Architecture:** Four targeted file edits — extend `prefs.ts` with two new fields, apply the font scale in `App.tsx` at startup, rewrite `SettingsScreen.tsx` JSX to use collapsible sections plus two new preference controls, and update the New Session button in `RegimensScreen.tsx` to pre-fill the target date.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript, NativeWind v4, `@react-native-async-storage/async-storage`, `react-native-css-interop` (re-exported as `rem` from `nativewind`)

---

## Worktree

Use a new worktree on branch `feature/settings-overhaul`:

```bash
cd D:/GitHub/PillPipe
git worktree add .worktrees/settings-overhaul -b feature/settings-overhaul
cd .worktrees/settings-overhaul/app && npm install
```

## Verification command

```bash
cd D:/GitHub/PillPipe/.worktrees/settings-overhaul/app && npx tsc --noEmit 2>&1
```

Expected: same pre-existing errors in `RegimensScreen.tsx` and `SettingsScreen.tsx` only — no new errors.

---

## File Map

| File | Change |
|---|---|
| `app/src/utils/prefs.ts` | Add `FontSize` type, `fontSize` and `defaultDuration` to `AppPrefs` and `DEFAULT` |
| `app/App.tsx` | Import `rem` + `loadPrefs`; call `rem.set()` after `initPrefs()` resolves |
| `app/src/screens/SettingsScreen.tsx` | Full JSX rewrite: collapsible sections, Preferences section, font size + duration controls |
| `app/src/screens/RegimensScreen.tsx` | Pre-fill target date and reset start date when New Session modal opens |

---

## Task 1: Extend AppPrefs with fontSize and defaultDuration

**Files:**
- Modify: `app/src/utils/prefs.ts`

**Context:** `prefs.ts` uses an AsyncStorage-backed module cache. `DEFAULT` is spread first when reading stored prefs (`{ ...DEFAULT, ...JSON.parse(raw) }`), so new fields auto-fill for existing installs.

- [ ] **Step 1: Read the current file**

```bash
cat D:/GitHub/PillPipe/.worktrees/settings-overhaul/app/src/utils/prefs.ts
```

Confirm the current `AppPrefs` interface and `DEFAULT` constant.

- [ ] **Step 2: Add `FontSize` type and extend `AppPrefs`**

Change:
```ts
export type AccentColor = 'violet' | 'red' | 'orange' | 'amber' | 'green' | 'blue';

export interface AppPrefs {
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  accentColor: AccentColor;
}
```

To:
```ts
export type AccentColor = 'violet' | 'red' | 'orange' | 'amber' | 'green' | 'blue';
export type FontSize = 'small' | 'medium' | 'large';

export interface AppPrefs {
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  accentColor: AccentColor;
  fontSize: FontSize;
  defaultDuration: 0 | 30 | 60 | 90 | 120;
}
```

- [ ] **Step 3: Update DEFAULT**

Change:
```ts
const DEFAULT: AppPrefs = { dateFormat: 'MM/DD/YYYY', accentColor: 'violet' };
```

To:
```ts
const DEFAULT: AppPrefs = {
  dateFormat: 'MM/DD/YYYY',
  accentColor: 'violet',
  fontSize: 'medium',
  defaultDuration: 0,
};
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd D:/GitHub/PillPipe/.worktrees/settings-overhaul/app && npx tsc --noEmit 2>&1
```

Expected: no new errors beyond the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
cd D:/GitHub/PillPipe/.worktrees/settings-overhaul
git add app/src/utils/prefs.ts
git commit -m "feat(app): add fontSize and defaultDuration to AppPrefs"
```

---

## Task 2: Apply font scale at app startup

**Files:**
- Modify: `app/App.tsx`

**Context:** `App.tsx` already calls `initPrefs()` in a `useEffect` and gates rendering with `prefsReady`. We need to call `rem.set()` after `initPrefs()` resolves so the NativeWind rem base is set before any screen renders. `rem` is the `Observable<number>` from `react-native-css-interop`, re-exported by `nativewind`. Its `.set(n)` method sets the rem base in pixels — Medium=14 (current NativeWind default), Small=12, Large=16.

- [ ] **Step 1: Add imports**

In `app/App.tsx`, add `rem` to the nativewind import and `loadPrefs` to the prefs import:

Change:
```tsx
import { initPrefs } from '@/utils/prefs';
```
To:
```tsx
import { initPrefs, loadPrefs } from '@/utils/prefs';
```

Add `import { rem } from 'nativewind';` to the imports block (after line 16 — the `SafeAreaProvider` import line):

Change:
```tsx
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
```
To:
```tsx
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { rem } from 'nativewind';
```

Then add `fontScaleMap` after `const Tab = createBottomTabNavigator();` (line 18, a module-level const — not an import):
```tsx
const fontScaleMap: Record<string, number> = { small: 12, medium: 14, large: 16 };
```

- [ ] **Step 2: Call rem.set() in the initPrefs useEffect**

Change:
```tsx
  useEffect(() => {
    (async () => {
      await initPrefs();
      setPrefsReady(true);
    })();
  }, []);
```

To:
```tsx
  useEffect(() => {
    (async () => {
      await initPrefs();
      rem.set(fontScaleMap[loadPrefs().fontSize] ?? 14);
      setPrefsReady(true);
    })();
  }, []);
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd D:/GitHub/PillPipe/.worktrees/settings-overhaul/app && npx tsc --noEmit 2>&1
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd D:/GitHub/PillPipe/.worktrees/settings-overhaul
git add app/App.tsx
git commit -m "feat(app): apply NativeWind rem font scale from prefs at startup"
```

---

## Task 3: Rewrite SettingsScreen with collapsible sections

**Files:**
- Modify: `app/src/screens/SettingsScreen.tsx`

**Context:** The current screen is a flat ScrollView of always-visible cards. This task adds a `SectionHeader` component, `openSections` state, and two new preference controls (font size, default duration). Date format moves from its own card into the Preferences section. All sections start collapsed. The `SectionHeader` component is defined outside `SettingsScreen` to avoid recreation on each render.

- [ ] **Step 1: Read the current file**

Read `app/src/screens/SettingsScreen.tsx` in full to understand the existing logic before editing.

- [ ] **Step 2: Add imports and SectionHeader component**

At the top of the file, after the existing imports, add:

```tsx
import { rem } from 'nativewind';
import { FontSize, loadPrefs, savePrefs } from '@/utils/prefs';
```

Wait — `loadPrefs`, `savePrefs`, `ACCENT_HEX`, `AccentColor`, `AppPrefs` are already imported. Only add what's missing. The current import line is:
```tsx
import { ACCENT_HEX, AccentColor, AppPrefs, loadPrefs, savePrefs } from '@/utils/prefs';
```

Change it to:
```tsx
import { ACCENT_HEX, AccentColor, AppPrefs, FontSize, loadPrefs, savePrefs } from '@/utils/prefs';
import { rem } from 'nativewind';
```

Add the `SectionHeader` component just before `export default function SettingsScreen()`:

```tsx
const fontScaleMap: Record<FontSize, number> = { small: 12, medium: 14, large: 16 };

function SectionHeader({ title, open, onPress }: { title: string; open: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center justify-between px-4 py-3">
      <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider">{title}</Text>
      <Text className="text-gray-600 text-xs">{open ? '▲' : '▼'}</Text>
    </Pressable>
  );
}
```

- [ ] **Step 3: Add new state variables inside SettingsScreen**

After the existing state declarations, add:

```tsx
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [defaultDuration, setDefaultDuration] = useState<AppPrefs['defaultDuration']>(0);
```

Add the toggle helper after the state declarations:

```tsx
  function toggleSection(name: string) {
    setOpenSections(p => ({ ...p, [name]: !p[name] }));
  }
```

- [ ] **Step 4: Load new prefs in the existing useEffect**

The existing `useEffect` already calls `loadPrefs()`. Extend it to also set `fontSize` and `defaultDuration`:

Change:
```tsx
  useEffect(() => {
    const prefs = loadPrefs();
    setDateFormat(prefs.dateFormat);
    setAccentColor(prefs.accentColor);
    Notifications.getPermissionsAsync()
      .then((s) => setNotifStatus(s.status))
      .catch(() => setNotifStatus('unavailable'));
    loadTemplates();
  }, []);
```

To:
```tsx
  useEffect(() => {
    const prefs = loadPrefs();
    setDateFormat(prefs.dateFormat);
    setAccentColor(prefs.accentColor);
    setFontSize(prefs.fontSize);
    setDefaultDuration(prefs.defaultDuration);
    Notifications.getPermissionsAsync()
      .then((s) => setNotifStatus(s.status))
      .catch(() => setNotifStatus('unavailable'));
    loadTemplates();
  }, []);
```

- [ ] **Step 5: Add applyFontSize and applyDefaultDuration helpers**

After the existing `applyAccentColor` function, add:

```tsx
  function applyFontSize(size: FontSize) {
    setFontSize(size);
    savePrefs({ fontSize: size });
    rem.set(fontScaleMap[size]);
  }

  function applyDefaultDuration(duration: AppPrefs['defaultDuration']) {
    setDefaultDuration(duration);
    savePrefs({ defaultDuration: duration });
  }
```

- [ ] **Step 6: Replace the return block with collapsible sections**

Replace the entire `return (...)` block with the following. Keep all existing handler functions (`exportBackup`, `importBackup`, `clearAllData`, etc.) unchanged — only the JSX changes.

```tsx
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
              <Text className="text-gray-600 text-xs mt-2">Applies to all text in the app.</Text>
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
              <Text className="text-gray-600 text-xs">Reminders fire at the time set on each regimen card.</Text>
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
```

Note: `DURATIONS` is declared **once**, just before `return (` — not inside the JSX. The copy shown at the top of the return block above is illustrative context only. Place it here:

```tsx
  const DURATIONS: Array<{ key: AppPrefs['defaultDuration']; label: string }> = [
    { key: 0,   label: 'None'     },
    { key: 30,  label: '30 days'  },
    { key: 60,  label: '60 days'  },
    { key: 90,  label: '90 days'  },
    { key: 120, label: '120 days' },
  ];
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd D:/GitHub/PillPipe/.worktrees/settings-overhaul/app && npx tsc --noEmit 2>&1
```

Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
cd D:/GitHub/PillPipe/.worktrees/settings-overhaul
git add app/src/screens/SettingsScreen.tsx
git commit -m "feat(app): collapsible Settings sections with font size and default duration prefs"
```

---

## Task 4: Pre-fill New Session modal with default duration

**Files:**
- Modify: `app/src/screens/RegimensScreen.tsx`

**Context:** The "+ New" button at line 654 currently just calls `setSelectedTemplateId(''); setSessionModal(true)`. It needs to also reset `sessionStart` to today and pre-fill `sessionTarget` based on `defaultDuration`. `loadPrefs` is not currently imported in this file.

- [ ] **Step 1: Add loadPrefs to the prefs import**

Find the existing import from `@/utils/prefs` in `RegimensScreen.tsx`. Currently there is none — prefs are not imported. Add a new import line after the `@/utils/dates` import:

```tsx
import { loadPrefs } from '@/utils/prefs';
```

- [ ] **Step 2: Update the New Session button onPress**

At line 654, change:
```tsx
        <Pressable onPress={() => { setSelectedTemplateId(''); setSessionModal(true); }} className="bg-violet-600 rounded-lg px-3 py-1.5">
```

To:
```tsx
        <Pressable
          onPress={() => {
            const prefs = loadPrefs();
            setSelectedTemplateId('');
            setSessionStart(todayISO());
            if (prefs.defaultDuration > 0) {
              const d = new Date();
              d.setDate(d.getDate() + prefs.defaultDuration);
              setSessionTarget(d.toISOString().slice(0, 10));
            } else {
              setSessionTarget('');
            }
            setSessionModal(true);
          }}
          className="bg-violet-600 rounded-lg px-3 py-1.5"
        >
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd D:/GitHub/PillPipe/.worktrees/settings-overhaul/app && npx tsc --noEmit 2>&1
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd D:/GitHub/PillPipe/.worktrees/settings-overhaul
git add app/src/screens/RegimensScreen.tsx
git commit -m "feat(app): pre-fill New Session target date from defaultDuration pref"
```

---

## Final Verification

After all tasks:

- [ ] TypeScript clean: `cd app && npx tsc --noEmit`
- [ ] Rebuild and deploy:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio1/jbr"
export ANDROID_HOME="/c/Users/Andrew/AppData/Local/Android/Sdk"
export PATH="$PATH:/c/Users/Andrew/AppData/Local/Android/Sdk/platform-tools"
cd D:/GitHub/PillPipe/.worktrees/settings-overhaul/app && npx expo run:android --port 8082
```

Manual checks:
1. Settings screen shows 7 collapsed sections with ▲/▼ chevrons
2. Tap each section — content expands/collapses
3. Open Preferences → Date Format, Default Duration, Font Size all present
4. Change Font Size to Large — text throughout app grows immediately
5. Change Default Duration to 30 days → create a new session — target date pre-fills to today + 30
6. Force-close app, reopen — font size and duration preference persist
