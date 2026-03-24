# Notification Times Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-slot reminder time picker with a multi-slot notification system (Morning / Lunch / Dinner / Custom, all independently active per regimen) with global preset times configurable in Settings.

**Architecture:** New `regimen_notifications` DB table stores per-regimen notification slots; preset types resolve to global times from AppPrefs; notification identifiers are deterministic for presets and UUID-based for custom slots. Boot-time reschedule in App.tsx keeps OS notifications in sync with current prefs.

**Tech Stack:** Expo SDK 54, expo-sqlite, expo-notifications, @react-native-community/datetimepicker, NativeWind 4, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-23-notification-times-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `app/src/db/database.ts` | Modify | Add `regimen_notifications` table + unique index to `migrate()` |
| `app/src/utils/types.ts` | Modify | Add `RegNotif` interface |
| `app/src/utils/prefs.ts` | Modify | Add `morningTime`, `lunchTime`, `dinnerTime` to `AppPrefs` |
| `app/src/utils/notifications.ts` | Rewrite | Replace `scheduleReminder`/`cancelReminder` with new API |
| `app/App.tsx` | Modify | Add boot-time reschedule after `initPrefs` |
| `app/src/screens/SettingsScreen.tsx` | Modify | Add Reminder Times subsection; import `DateTimePicker` |
| `app/src/screens/RegimensScreen.tsx` | Modify | Remove old reminder system; add notification slots UI |
| `app/tailwind.config.js` | Modify | Add rem-based font size overrides |

---

## Task 1: Schema — `regimen_notifications` table

**Files:**
- Modify: `app/src/db/database.ts`

- [ ] **Step 1: Add table + index to `migrate()`**

  Open `app/src/db/database.ts`. After the existing `session_templates` `execAsync` block, add two more calls:

  ```ts
  await db.execAsync(`CREATE TABLE IF NOT EXISTS regimen_notifications (
    id          TEXT PRIMARY KEY,
    regimen_id  TEXT NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('morning','lunch','dinner','custom')),
    custom_time TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );`);

  await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_regimen_notif_preset
    ON regimen_notifications(regimen_id, type)
    WHERE type != 'custom';`);
  ```

- [ ] **Step 2: Add `RegNotif` type**

  Open `app/src/utils/types.ts`. Append:

  ```ts
  export interface RegNotif {
    id: string;
    regimen_id: string;
    type: 'morning' | 'lunch' | 'dinner' | 'custom';
    custom_time: string | null;
  }
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add app/src/db/database.ts app/src/utils/types.ts
  git commit -m "feat(app): add regimen_notifications table and RegNotif type"
  ```

---

## Task 2: AppPrefs — preset times

**Files:**
- Modify: `app/src/utils/prefs.ts`

- [ ] **Step 1: Extend `AppPrefs` interface and defaults**

  In `app/src/utils/prefs.ts`:

  Add to `AppPrefs` interface:
  ```ts
  morningTime: string;  // "HH:MM"
  lunchTime:   string;
  dinnerTime:  string;
  ```

  Add to `DEFAULT`:
  ```ts
  morningTime: '08:00',
  lunchTime:   '12:00',
  dinnerTime:  '18:00',
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: no errors. (SettingsScreen will error until Task 5 — that's fine for now; check only `prefs.ts` compiles in isolation if needed.)

- [ ] **Step 3: Commit**

  ```bash
  git add app/src/utils/prefs.ts
  git commit -m "feat(app): add morningTime/lunchTime/dinnerTime to AppPrefs"
  ```

---

## Task 3: Notifications utility — new API

**Files:**
- Rewrite: `app/src/utils/notifications.ts`

- [ ] **Step 1: Replace file contents**

  Replace `app/src/utils/notifications.ts` entirely with:

  ```ts
  import * as Notifications from 'expo-notifications';
  import { AppPrefs } from './prefs';
  import { RegNotif } from './types';

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  // ── Identifier helpers ────────────────────────────────────────────────────────

  function presetId(regimenId: string, type: 'morning' | 'lunch' | 'dinner'): string {
    return `reminder-${regimenId}-${type}`;
  }

  function customId(entryId: string): string {
    return `reminder-${entryId}`;
  }

  export function resolveTime(
    type: RegNotif['type'],
    customTime: string | null,
    prefs: Pick<AppPrefs, 'morningTime' | 'lunchTime' | 'dinnerTime'>,
  ): string | null {
    if (type === 'custom') return customTime;
    if (type === 'morning') return prefs.morningTime;
    if (type === 'lunch') return prefs.lunchTime;
    if (type === 'dinner') return prefs.dinnerTime;
    return null;
  }

  // ── Schedule / cancel ─────────────────────────────────────────────────────────

  export async function scheduleAllForRegimen(
    regimenId: string,
    supplementName: string,
    entries: RegNotif[],
    prefs: Pick<AppPrefs, 'morningTime' | 'lunchTime' | 'dinnerTime'>,
  ): Promise<void> {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    // Cancel all existing slots for this regimen first
    await cancelAllForRegimen(regimenId, entries.filter(e => e.type === 'custom').map(e => e.id));

    for (const entry of entries) {
      const time = resolveTime(entry.type, entry.custom_time, prefs);
      if (!time) continue;
      const [hh, mm] = time.split(':').map(Number);
      const identifier = entry.type === 'custom'
        ? customId(entry.id)
        : presetId(regimenId, entry.type as 'morning' | 'lunch' | 'dinner');

      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: 'PillPipe Reminder',
          body: `Time to take your ${supplementName}`,
          data: { regimenId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: hh,
          minute: mm,
        },
      });
    }
  }

  export async function cancelAllForRegimen(
    regimenId: string,
    customEntryIds: string[],
  ): Promise<void> {
    // Cancel deterministic preset identifiers
    for (const type of ['morning', 'lunch', 'dinner'] as const) {
      try {
        await Notifications.cancelScheduledNotificationAsync(presetId(regimenId, type));
      } catch { /* no-op if not scheduled */ }
    }
    // Cancel custom identifiers
    for (const id of customEntryIds) {
      try {
        await Notifications.cancelScheduledNotificationAsync(customId(id));
      } catch { /* no-op */ }
    }
  }

  export async function cancelSingleEntry(
    regimenId: string,
    entryId: string,
    type: RegNotif['type'],
  ): Promise<void> {
    const identifier = type === 'custom'
      ? customId(entryId)
      : presetId(regimenId, type as 'morning' | 'lunch' | 'dinner');
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    } catch { /* no-op */ }
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: errors only in files that still import the old `scheduleReminder`/`cancelReminder` — those are fixed in later tasks.

- [ ] **Step 3: Commit**

  ```bash
  git add app/src/utils/notifications.ts
  git commit -m "feat(app): rewrite notifications utility for multi-slot regimen reminders"
  ```

---

## Task 4: Settings — Reminder Times UI

**Files:**
- Modify: `app/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Add `DateTimePicker` import**

  Add to imports at top of `SettingsScreen.tsx`:
  ```ts
  import DateTimePicker from '@react-native-community/datetimepicker';
  ```

- [ ] **Step 2: Add state for time picker**

  Inside `SettingsScreen()`, after existing state declarations, add:
  ```ts
  const [showTimePicker, setShowTimePicker] = useState<'morning' | 'lunch' | 'dinner' | null>(null);
  const [morningTime, setMorningTime] = useState<string>('08:00');
  const [lunchTime, setLunchTime] = useState<string>('12:00');
  const [dinnerTime, setDinnerTime] = useState<string>('18:00');
  ```

- [ ] **Step 3: Load preset times from prefs in `useEffect`**

  In the existing `useEffect` that calls `loadPrefs()`, add:
  ```ts
  setMorningTime(prefs.morningTime);
  setLunchTime(prefs.lunchTime);
  setDinnerTime(prefs.dinnerTime);
  ```

- [ ] **Step 4: Add save helpers**

  ```ts
  function applyPresetTime(type: 'morning' | 'lunch' | 'dinner', time: string) {
    if (type === 'morning') setMorningTime(time);
    else if (type === 'lunch') setLunchTime(time);
    else setDinnerTime(time);
    savePrefs({ [`${type}Time`]: time } as any);
  }
  ```

- [ ] **Step 5: Add Reminder Times subsection inside the Notifications section**

  After the existing "Reminders fire at the time set on each regimen card." text (inside the `notifStatus === 'granted'` branch), replace the `<View className="gap-2">` block with:

  ```tsx
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
  ```

  Also add `Platform` to the `react-native` import if not already present.

- [ ] **Step 6: Verify TypeScript compiles**

  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: no new errors.

- [ ] **Step 7: Commit**

  ```bash
  git add app/src/screens/SettingsScreen.tsx
  git commit -m "feat(app): add Reminder Times settings section with Morning/Lunch/Dinner pickers"
  ```

---

## Task 5: Boot-time reschedule in App.tsx

**Files:**
- Modify: `app/App.tsx`

- [ ] **Step 1: Add imports**

  In `app/App.tsx`, add to existing imports:
  ```ts
  import { getDb } from '@/db/database';
  import { RegNotif } from '@/utils/types';
  import { scheduleAllForRegimen } from '@/utils/notifications';
  ```

  (`getDb` and `Notifications` are already imported.)

- [ ] **Step 2: Add reschedule logic inside the startup effect**

  In the existing `useEffect` that calls `initPrefs()`, after `rem.set(...)` and before `setPrefsReady(true)`:

  ```ts
  // Reschedule all notifications to reflect current preset times
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') {
      const db = await getDb();
      const regimens = await db.getAllAsync<{ id: string; supplement_id: string }>(
        'SELECT id, supplement_id FROM regimens',
      );
      const currentPrefs = loadPrefs();
      for (const r of regimens) {
        const entries = await db.getAllAsync<RegNotif>(
          'SELECT * FROM regimen_notifications WHERE regimen_id = ?',
          [r.id],
        );
        if (entries.length === 0) continue;
        const sup = await db.getFirstAsync<{ name: string }>(
          'SELECT name FROM supplements WHERE id = ?',
          [r.supplement_id],
        );
        await scheduleAllForRegimen(r.id, sup?.name ?? 'supplement', entries, currentPrefs);
      }
    }
  } catch { /* non-critical — don't block app startup */ }
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd app && npx tsc --noEmit
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add app/App.tsx
  git commit -m "feat(app): reschedule all notifications at startup to sync with preset times"
  ```

---

## Task 6: RegimensScreen — remove old reminder system

**Files:**
- Modify: `app/src/screens/RegimensScreen.tsx`

- [ ] **Step 1: Update imports**

  - Remove: `import * as SQLite from 'expo-sqlite';` (unused orphan)
  - Add: `import DateTimePicker from '@react-native-community/datetimepicker';`
  - Update notifications import:
    ```ts
    import { cancelAllForRegimen, cancelSingleEntry, scheduleAllForRegimen } from '@/utils/notifications';
    ```
  - Add to types import: `RegNotif`
  - Ensure `uuid` is included in the `@/db/database` import:
    ```ts
    import { getDb, uuid } from '@/db/database';
    ```
  - Ensure `loadPrefs` is included in the `@/utils/prefs` import:
    ```ts
    import { loadPrefs } from '@/utils/prefs';
    ```
  - `Platform` is already in the `react-native` import — confirm it's present, add if missing.

- [ ] **Step 2: Remove old reminder state and functions**

  Delete the following from the component:
  - `const [reminderTimes, setReminderTimes] = useState<Record<string, string>>({});`
  - `const [showReminderPicker, setShowReminderPicker] = useState<string | null>(null);`
  - The entire `saveReminderTime()` function
  - In `openSession()`: the `timesMap` block and `setReminderTimes(timesMap)` call
  - In `reloadOpenSession()`: the `timesMap2` block and `setReminderTimes(timesMap2)` call

- [ ] **Step 3: Verify TypeScript compiles (expect errors from old JSX still present)**

  ```bash
  cd app && npx tsc --noEmit 2>&1 | head -30
  ```

- [ ] **Step 4: Add new notification state**

  ```ts
  const [notifEntries, setNotifEntries] = useState<Record<string, RegNotif[]>>({});
  const [showCustomTimePicker, setShowCustomTimePicker] = useState<string | null>(null); // regimenId
  ```

- [ ] **Step 5: Load notification entries in `openSession()`**

  After the `setPhases(phaseMap)` call, add:
  ```ts
  const notifMap: Record<string, RegNotif[]> = {};
  for (const r of regs) {
    const entries = await db.getAllAsync<RegNotif>(
      'SELECT * FROM regimen_notifications WHERE regimen_id = ? ORDER BY created_at',
      [r.id],
    );
    notifMap[r.id] = entries;
  }
  setNotifEntries(notifMap);
  ```

  Do the same in `reloadOpenSession()` (same pattern, after `setPhases(phaseMap)`):
  ```ts
  const notifMap2: Record<string, RegNotif[]> = {};
  for (const r of regs) {
    const entries = await db.getAllAsync<RegNotif>(
      'SELECT * FROM regimen_notifications WHERE regimen_id = ? ORDER BY created_at',
      [r.id],
    );
    notifMap2[r.id] = entries;
  }
  setNotifEntries(notifMap2);
  ```

- [ ] **Step 6: Add notification mutation functions**

  Add after the phase CRUD functions:

  ```ts
  // ── Notification slot mutations ───────────────────────────────────────────────

  async function togglePresetNotif(regimenId: string, type: 'morning' | 'lunch' | 'dinner') {
    try {
      const db = await getDb();
      const existing = notifEntries[regimenId]?.find(e => e.type === type);
      if (existing) {
        await cancelSingleEntry(regimenId, existing.id, type);
        await db.runAsync('DELETE FROM regimen_notifications WHERE id=?', [existing.id]);
      } else {
        const newId = uuid();
        await db.runAsync(
          'INSERT INTO regimen_notifications (id, regimen_id, type) VALUES (?,?,?)',
          [newId, regimenId, type],
        );
        const reg = regimens.find(r => r.id === regimenId);
        const prefs = loadPrefs();
        const all = await db.getAllAsync<RegNotif>(
          'SELECT * FROM regimen_notifications WHERE regimen_id = ?', [regimenId],
        );
        await scheduleAllForRegimen(regimenId, reg?.supplement_name ?? 'supplement', all, prefs);
      }
      await reloadOpenSession();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  }

  async function addCustomNotif(regimenId: string, time: string) {
    try {
      const db = await getDb();
      const newId = uuid();
      await db.runAsync(
        'INSERT INTO regimen_notifications (id, regimen_id, type, custom_time) VALUES (?,?,?,?)',
        [newId, regimenId, 'custom', time],
      );
      const reg = regimens.find(r => r.id === regimenId);
      const prefs = loadPrefs();
      const all = await db.getAllAsync<RegNotif>(
        'SELECT * FROM regimen_notifications WHERE regimen_id = ?', [regimenId],
      );
      await scheduleAllForRegimen(regimenId, reg?.supplement_name ?? 'supplement', all, prefs);
      await reloadOpenSession();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  }

  async function removeNotifEntry(regimenId: string, entryId: string, type: RegNotif['type']) {
    try {
      const db = await getDb();
      await cancelSingleEntry(regimenId, entryId, type);
      await db.runAsync('DELETE FROM regimen_notifications WHERE id=?', [entryId]);
      await reloadOpenSession();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  }
  ```

- [ ] **Step 7: Update `deleteRegimen` to cancel OS notifications before DB delete**

  Replace the body of the destructive handler in `deleteRegimen`:
  ```ts
  onPress: async () => {
    try {
      const db = await getDb();
      const entries = await db.getAllAsync<RegNotif>(
        'SELECT * FROM regimen_notifications WHERE regimen_id = ?', [regimenId],
      );
      await cancelAllForRegimen(regimenId, entries.filter(e => e.type === 'custom').map(e => e.id));
      await db.runAsync('DELETE FROM regimens WHERE id=?', [regimenId]);
      await reloadOpenSession();
    } catch (e) {
      Alert.alert('Error', 'Could not remove regimen: ' + String(e));
    }
  },
  ```

- [ ] **Step 8: Replace old reminder row JSX with new Notifications section**

  First, find the line `const openSess = sessions.find(...)` near the top of the `return` block and add the following line immediately before it:
  ```ts
  const currentPrefs = loadPrefs();
  ```
  This reads prefs once per render, avoiding repeated calls inside the nested map.

  Then find the entire reminder block (from `{/* Reminder time */}` comment through the closing `}` of the `DateTimePicker` conditional) and replace it with:

  ```tsx
  {/* Notifications */}
  <View className="mt-3 border-t border-gray-700/50 pt-3">
    <Text className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">Notifications</Text>
    <View className="flex-row gap-2 flex-wrap mb-2">
      {(['morning', 'lunch', 'dinner'] as const).map((type) => {
        const active = notifEntries[r.id]?.some(e => e.type === type);
        const time = currentPrefs[`${type}Time` as keyof typeof currentPrefs] as string;
        return (
          <Pressable
            key={type}
            onPress={() => togglePresetNotif(r.id, type)}
            className={`px-3 py-1.5 rounded-lg border ${active ? 'bg-violet-600 border-violet-500' : 'bg-gray-800 border-gray-700'}`}
          >
            <Text className={`text-xs font-medium capitalize ${active ? 'text-white' : 'text-gray-400'}`}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </Text>
            {active && <Text className="text-violet-200 text-xs font-mono">{time}</Text>}
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => setShowCustomTimePicker(r.id)}
        className="px-3 py-1.5 rounded-lg border bg-gray-800 border-gray-700"
      >
        <Text className="text-xs font-medium text-gray-400">+ Custom</Text>
      </Pressable>
    </View>

    {/* Custom time rows */}
    {notifEntries[r.id]?.filter(e => e.type === 'custom').map(e => (
      <View key={e.id} className="flex-row items-center justify-between py-1">
        <Text className="text-gray-400 text-xs font-mono">Custom · {e.custom_time}</Text>
        <Pressable onPress={() => removeNotifEntry(r.id, e.id, 'custom')} hitSlop={8}>
          <Text className="text-red-700 text-xs px-1">✕</Text>
        </Pressable>
      </View>
    ))}

    {/* Custom time picker */}
    {showCustomTimePicker === r.id && (
      <DateTimePicker
        value={new Date()}
        mode="time"
        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
        onChange={(_, date) => {
          setShowCustomTimePicker(null);
          if (date) {
            const hh = String(date.getHours()).padStart(2, '0');
            const mm = String(date.getMinutes()).padStart(2, '0');
            addCustomNotif(r.id, `${hh}:${mm}`);
          }
        }}
      />
    )}
  </View>
  ```

- [ ] **Step 9: Verify TypeScript compiles clean**

  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 10: Commit**

  ```bash
  git add app/src/screens/RegimensScreen.tsx
  git commit -m "feat(app): replace single reminder picker with multi-slot notification system"
  ```

---

## Task 7: Font size — Tailwind rem override

**Files:**
- Modify: `app/tailwind.config.js`

- [ ] **Step 1: Add rem-based font sizes to theme extension**

  In `app/tailwind.config.js`, inside `theme.extend`, add:

  ```js
  fontSize: {
    xs:   ['0.75rem',  { lineHeight: '1rem' }],
    sm:   ['0.875rem', { lineHeight: '1.25rem' }],
    base: ['1rem',     { lineHeight: '1.5rem' }],
    lg:   ['1.125rem', { lineHeight: '1.75rem' }],
    xl:   ['1.25rem',  { lineHeight: '1.75rem' }],
    '2xl':['1.5rem',   { lineHeight: '2rem' }],
  },
  ```

  `App.tsx` already calls `rem.set(fontScaleMap[loadPrefs().fontSize])` at startup — no other changes needed.

- [ ] **Step 2: Commit**

  ```bash
  git add app/tailwind.config.js
  git commit -m "fix(app): use rem-based font sizes so rem.set() scales text globally"
  ```

---

## Task 8: Build and deploy

- [ ] **Step 1: Full TypeScript check**

  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 2: Build and push to device**

  ```bash
  cd app && JAVA_HOME="/c/Program Files/Android/Android Studio1/jbr" \
    ANDROID_HOME="/c/Users/Andrew/AppData/Local/Android/Sdk" \
    npx expo run:android
  ```

- [ ] **Step 3: Manual verification checklist**

  - [ ] App starts without crash
  - [ ] Settings → Notifications shows Morning / Lunch / Dinner time rows
  - [ ] Tapping a row opens time picker; new time persists after closing Settings
  - [ ] Regimen card shows Notifications section with 4 controls
  - [ ] Tapping Morning/Lunch/Dinner toggles active state and chip fills
  - [ ] Tapping `+ Custom` opens time picker; custom time appears as deletable row
  - [ ] Multiple notification slots can be active simultaneously on one regimen
  - [ ] Tapping ✕ on a custom slot removes it
  - [ ] Deleting a regimen does not leave orphaned OS notifications
  - [ ] Font size Small/Medium/Large in Settings scales text on next restart
  - [ ] CSV export (after running Calculate) shares successfully
  - [ ] Test Notification button fires a notification when permission is granted

- [ ] **Step 4: Final commit (docs update)**

  ```bash
  git add app/TODO.md
  git commit -m "docs(app): update TODO — notification times sprint complete"
  ```
