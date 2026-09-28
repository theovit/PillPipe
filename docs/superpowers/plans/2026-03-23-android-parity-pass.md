# Android Parity Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 bugs (timezone drift in adherence calendar, notification handler not registered at startup, notification tap does not log dose, backup restore uses unreliable multi-statement execAsync) and implement session templates.

**Architecture:** All changes are confined to `app/`. No network calls, no server changes. Bugs 2 and 3 both touch `App.tsx` and are grouped into one task. Session templates split across three files: DB migration, RegimensScreen UI, SettingsScreen UI.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript 5.9, expo-sqlite 16, expo-notifications 0.32, NativeWind 4

---

## No Test Framework

This project has no Jest setup. Verification uses:
- **Type check:** `cd app && npx tsc --noEmit` -- must produce zero errors
- **Manual smoke test:** run `npx expo start` from the `app/` directory, scan the QR code with Expo Go, and follow the manual steps listed per task

---

## File Map

| File | Tasks | What changes |
|---|---|---|
| `app/src/utils/dates.ts` | Task 1 | `todayISO()` and `daysFromNow()` use local date instead of UTC |
| `app/src/components/AdherenceCalendar.tsx` | Task 1 | `isoDate()` helper uses local date instead of UTC |
| `app/App.tsx` | Task 2 | Bare notifications import; notification response listener |
| `app/src/screens/SettingsScreen.tsx` | Tasks 3, 5 | Restore uses `withExclusiveTransactionAsync`; Templates section added |
| `app/src/db/database.ts` | Task 4 | `session_templates` table added to `migrate()` |
| `app/src/screens/RegimensScreen.tsx` | Task 5 | "Save as template" in Edit Session modal; template picker in New Session modal |
| `app/TODO.md` | Task 6 | Mark confirmed-done items complete |

---

## Task 1: Fix Timezone Drift in Date Utilities

**Root cause:** `todayISO()`, `daysFromNow()`, and `isoDate()` in `AdherenceCalendar.tsx` all call `.toISOString().slice(0, 10)`, which returns the UTC date. In any timezone behind UTC, after the daily crossover point this returns tomorrow's local date, misaligning the adherence calendar's "today" dot and 30-day window.

**Files:**
- Modify: `app/src/utils/dates.ts`
- Modify: `app/src/components/AdherenceCalendar.tsx`

- [ ] **Step 1: Open `app/src/utils/dates.ts` and replace `todayISO()`**

  Current (line 15):
  ```ts
  export function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
  }
  ```

  Replace with:
  ```ts
  export function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  ```

- [ ] **Step 2: In the same file, replace `daysFromNow()`**

  Current (lines 18-22):
  ```ts
  export function daysFromNow(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  ```

  Replace with:
  ```ts
  export function daysFromNow(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  ```

- [ ] **Step 3: Open `app/src/components/AdherenceCalendar.tsx` and replace the `isoDate()` helper**

  Current (lines 16-18):
  ```ts
  function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
  ```

  Replace with:
  ```ts
  function isoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  ```

- [ ] **Step 4: Type-check**

  ```bash
  cd app && npx tsc --noEmit
  ```

  Expected: zero errors. If errors appear, they are unrelated to this task -- fix only errors in the two files just modified.

- [ ] **Step 5: Manual smoke test**

  Start the app (`npx expo start`). Open a session with at least one regimen. Scroll to the adherence calendar. The dot for today must be highlighted (ring around it). Check that the 30-day window starts from 30 days ago and ends at today's date -- count the dots if needed.

- [ ] **Step 6: Commit**

  ```bash
  cd app && git add src/utils/dates.ts src/components/AdherenceCalendar.tsx
  git commit -m "fix(app): use local date in todayISO and isoDate to fix adherence calendar timezone drift"
  ```

---

## Task 2: Register Notification Handler at Startup + Auto-Log on Tap

Both changes go in `App.tsx` and are committed together.

**Background:**
- Bug 2: `setNotificationHandler` in `notifications.ts` only runs when that module is first imported. `RegimensScreen.tsx` imports it, but if the app cold-starts on a different tab, the handler is never registered and notifications fail to display.
- Bug 3: No `addNotificationResponseReceivedListener` exists. Tapping a notification opens the app but does not log the dose.

**Files:**
- Modify: `app/App.tsx`

- [ ] **Step 1: Open `app/App.tsx` and add the bare notifications import**

  After the existing imports block (after the last `import` line, before the `const Tab = ...` line), add:

  ```ts
  import '@/utils/notifications'; // registers setNotificationHandler at app startup
  ```

  Note: `@/` resolves to `app/src/` in this project (see `babel.config.js`). This import resolves to `app/src/utils/notifications.ts`.

- [ ] **Step 2: Add the missing imports needed by the tap listener**

  `App.tsx` currently imports from `react` and `expo-status-bar` and `@react-navigation/native`, etc. Add these imports which are not yet present:

  ```ts
  import { useEffect } from 'react';
  import * as Notifications from 'expo-notifications';
  import { getDb, uuid } from '@/db/database';
  import { todayISO } from '@/utils/dates';
  ```

  Place these alongside the existing imports at the top of the file.

- [ ] **Step 3: Add the notification response listener inside the `App` component**

  The `App` function currently returns JSX directly. Add a `useEffect` at the top of the function body, before the `return`:

  ```ts
  export default function App() {
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

    return (
      // ... existing JSX unchanged
    );
  }
  ```

- [ ] **Step 4: Type-check**

  ```bash
  cd app && npx tsc --noEmit
  ```

  Expected: zero errors. The new imports must resolve correctly. If `@/db/database` or `@/utils/dates` produce "module not found" errors, verify the `babel.config.js` alias config -- the alias root is `app/src/`.

- [ ] **Step 5: Manual smoke test for Bug 2**

  1. Set a reminder time on any regimen card (tap "Reminder: none", pick a time 2 minutes from now).
  2. Force-close the app so it cold-starts.
  3. Reopen the app. Navigate directly to Supplements tab (do NOT go to Regimens first).
  4. Wait for the reminder time. The notification must appear even though you never visited Regimens.

- [ ] **Step 6: Manual smoke test for Bug 3**

  1. Set a reminder time 1 minute from now on a regimen that has no dose logged today.
  2. Lock the phone screen or background the app.
  3. When the notification fires, tap it.
  4. Open the app and navigate to the Regimens tab. The regimen must show "Taken today."

- [ ] **Step 7: Commit**

  ```bash
  cd app && git add App.tsx
  git commit -m "fix(app): register notification handler at startup and auto-log dose on notification tap"
  ```

---

## Task 3: Fix Backup Restore Transaction

**Root cause:** `importBackup` in `SettingsScreen.tsx` uses `db.execAsync()` with a multi-statement string to delete all rows before inserting backup data. `execAsync` does not guarantee multi-statement execution on all Android SQLite versions. If it stops after the first DELETE, subsequent inserts collide with stale rows.

**Fix:** Replace the multi-statement `execAsync` with `withExclusiveTransactionAsync` wrapping all DELETEs and all INSERT loops together. `withExclusiveTransactionAsync` passes a `txn` object -- all queries inside must call `txn.runAsync`, not `db.runAsync`.

**Files:**
- Modify: `app/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Open `SettingsScreen.tsx` and locate the `importBackup` function**

  The function is at approximately line 82. Inside the `onPress: async () => { ... }` callback (around line 104), find:

  ```ts
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM dose_log;
    DELETE FROM phases;
    DELETE FROM regimens;
    DELETE FROM sessions;
    DELETE FROM supplements;
  `);
  for (const row of (data.supplements ?? [])) { ... }
  for (const row of (data.sessions ?? [])) { ... }
  for (const row of (data.regimens ?? [])) { ... }
  for (const row of (data.phases ?? [])) { ... }
  for (const row of (data.dose_log ?? [])) { ... }
  Alert.alert('Restored', ...);
  ```

- [ ] **Step 2: Replace the execAsync + insert loops with a single withExclusiveTransactionAsync**

  Replace the entire block above (from `const db = await getDb()` through the last `for` loop, but NOT the `Alert.alert` call) with:

  ```ts
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
  ```

- [ ] **Step 3: Type-check**

  ```bash
  cd app && npx tsc --noEmit
  ```

  Expected: zero errors. If TypeScript complains about `withExclusiveTransactionAsync`, verify `expo-sqlite` version is 16.x (`package.json` shows `~16.0.10` which includes this API).

- [ ] **Step 4: Manual smoke test**

  1. Add at least one supplement and one session with a regimen and a phase.
  2. Go to Settings -> Export backup (JSON). Share it to Files or email.
  3. Go to Settings -> Clear all data. Verify Regimens shows empty.
  4. Go to Settings -> Restore from backup. Pick the exported file.
  5. Navigate to Regimens. All sessions and regimens must be present. Navigate to Supplements. All supplements must be present.

- [ ] **Step 5: Commit**

  ```bash
  cd app && git add src/screens/SettingsScreen.tsx
  git commit -m "fix(app): use withExclusiveTransactionAsync for backup restore atomicity"
  ```

---

## Task 4: Session Templates DB Migration

Add the `session_templates` table. This must land before the UI tasks that use it.

**Table schema:**
```sql
CREATE TABLE IF NOT EXISTS session_templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,   -- JSON: { regimens: [{ supplement_id, notes, phases: [...] }] }
  created_at TEXT DEFAULT (datetime('now'))
);
```

The `data` JSON shape:
```json
{
  "regimens": [
    {
      "supplement_id": "uuid-string",
      "notes": "optional notes string or null",
      "phases": [
        {
          "dosage": 2,
          "duration_days": 30,
          "days_of_week": null,
          "indefinite": 0,
          "sequence_order": 0
        }
      ]
    }
  ]
}
```

`reminder_time` is intentionally excluded -- it is personal to each session instance and should not be copied into templates.

**Files:**
- Modify: `app/src/db/database.ts`

- [ ] **Step 1: Open `app/src/db/database.ts` and add the table to the `migrate()` function**

  The `migrate` function contains one large `db.execAsync(...)` call (lines 23-78). Append the new table definition inside that template literal, after the `dose_log` table definition:

  ```ts
  CREATE TABLE IF NOT EXISTS session_templates (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  ```

  The full updated `execAsync` string should end with this table before the closing backtick.

- [ ] **Step 2: Type-check**

  ```bash
  cd app && npx tsc --noEmit
  ```

  Expected: zero errors.

- [ ] **Step 3: Verify the table is created**

  Start the app. The `migrate()` function runs on every cold start via `getDb()`. If no crash occurs on the Regimens screen load (which triggers `getDb()`), the migration ran successfully. You can also add a temporary `console.log` after `migrate()` and check Metro logs.

- [ ] **Step 4: Commit**

  ```bash
  cd app && git add src/db/database.ts
  git commit -m "feat(app): add session_templates table to SQLite migration"
  ```

---

## Task 5: Session Templates UI

This task adds the full templates feature across two screens. Read the current state of both files before making changes.

**RegimensScreen changes:**
1. Edit Session modal: add "Save as template" button that opens a name-input modal
2. New Session modal: add a "From template" picker (hidden when no templates exist)

**SettingsScreen changes:**
3. New "Templates" section: lists saved templates with a delete button per row; hidden when empty

**New state needed in `RegimensScreen.tsx`:**
- `templates: { id: string; name: string }[]` -- list loaded on screen focus
- `templateModal: boolean` -- controls the name-input modal
- `templateName: string` -- name input value
- `selectedTemplateId: string` -- selected template when creating new session

**Files:**
- Modify: `app/src/db/database.ts` -- no changes needed (table already added in Task 4)
- Modify: `app/src/screens/RegimensScreen.tsx`
- Modify: `app/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Add template state to `RegimensScreen.tsx`**

  In the state declarations block near the top of the component, add:

  ```ts
  const [templates, setTemplates] = useState<{ id: string; name: string; data: string }[]>([]);
  const [templateModal, setTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  ```

- [ ] **Step 2: Load templates on screen focus**

  The `useFocusEffect` callback at the top of the component calls `loadSessions()`. Add a `loadTemplates()` call alongside it:

  ```ts
  useFocusEffect(
    useCallback(() => {
      loadSessions();
      loadTemplates();
    }, []),
  );
  ```

  Then add the `loadTemplates` function after `loadSessions`:

  ```ts
  async function loadTemplates() {
    try {
      const db = await getDb();
      const rows = await db.getAllAsync<{ id: string; name: string; data: string }>(
        'SELECT id, name, data FROM session_templates ORDER BY created_at DESC',
      );
      setTemplates(rows);
    } catch { /* no-op */ }
  }
  ```

- [ ] **Step 3: Add `saveAsTemplate` function**

  Add this function after `loadTemplates`:

  ```ts
  async function saveAsTemplate() {
    if (!editingSession || !templateName.trim()) return;
    try {
      const db = await getDb();
      const regs = await db.getAllAsync<Regimen>(
        'SELECT * FROM regimens WHERE session_id = ?',
        [editingSession.id],
      );
      const regimenData = await Promise.all(
        regs.map(async (r) => {
          const ps = await db.getAllAsync<Phase>(
            'SELECT dosage, duration_days, days_of_week, indefinite, sequence_order FROM phases WHERE regimen_id = ? ORDER BY sequence_order',
            [r.id],
          );
          return { supplement_id: r.supplement_id, notes: r.notes, phases: ps };
        }),
      );
      const data = JSON.stringify({ regimens: regimenData });
      await db.runAsync(
        'INSERT INTO session_templates (id, name, data) VALUES (?, ?, ?)',
        [uuid(), templateName.trim(), data],
      );
      setTemplateModal(false);
      setTemplateName('');
      await loadTemplates();
      Alert.alert('Template saved', `"${templateName.trim()}" saved.`);
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  }
  ```

- [ ] **Step 4: Add `createSessionFromTemplate` function**

  This function applies a template after a new session is created. It is called inside `createSession` after the INSERT, if `selectedTemplateId` is set. Add this helper:

  ```ts
  async function applyTemplate(db: SQLite.SQLiteDatabase, sessionId: string, templateId: string) {
    const row = await db.getFirstAsync<{ data: string }>(
      'SELECT data FROM session_templates WHERE id = ?',
      [templateId],
    );
    if (!row) return;
    const parsed = JSON.parse(row.data) as {
      regimens: Array<{ supplement_id: string; notes: string | null; phases: Phase[] }>;
    };
    for (const tr of parsed.regimens) {
      // Skip if the supplement no longer exists
      const supExists = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM supplements WHERE id = ?',
        [tr.supplement_id],
      );
      if (!supExists) continue;
      const newRegimenId = uuid();
      await db.runAsync(
        'INSERT INTO regimens (id, session_id, supplement_id, notes) VALUES (?, ?, ?, ?)',
        [newRegimenId, sessionId, tr.supplement_id, tr.notes],
      );
      for (const p of tr.phases) {
        await db.runAsync(
          'INSERT INTO phases (id, regimen_id, dosage, duration_days, days_of_week, indefinite, sequence_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uuid(), newRegimenId, p.dosage, p.duration_days, p.days_of_week, p.indefinite, p.sequence_order],
        );
      }
    }
  }
  ```

  Note: `SQLite` is from `expo-sqlite`. Add this import at the top if not already present:
  ```ts
  import * as SQLite from 'expo-sqlite';
  ```

- [ ] **Step 5: Update `createSession` to apply the template if one is selected**

  The existing `createSession` function (around line 315) ends with:
  ```ts
  setSessionModal(false);
  loadSessions();
  ```

  Update it to apply the template and then open the new session:

  ```ts
  async function createSession() {
    if (!sessionStart || !sessionTarget) { Alert.alert('Start and target dates are required'); return; }
    if (sessionTarget <= sessionStart) { Alert.alert('Target must be after start date'); return; }
    try {
      const db = await getDb();
      const newId = uuid();
      await db.runAsync(
        'INSERT INTO sessions (id,start_date,target_date,notes) VALUES (?,?,?,?)',
        [newId, sessionStart, sessionTarget, sessionNotes.trim() || null],
      );
      if (selectedTemplateId) {
        await applyTemplate(db, newId, selectedTemplateId);
        setSelectedTemplateId('');
      }
      setSessionModal(false);
      await loadSessions();
      setOpenSessionId(newId);  // auto-open the new session
    } catch {
      Alert.alert('Error', 'Could not create session');
    }
  }
  ```

- [ ] **Step 6: Add "Save as template" button to Edit Session modal**

  In the Edit Session modal JSX (around line 920), after the "Save Changes" button and before the "Duplicate Session" button, add:

  ```tsx
  <Pressable
    onPress={() => { setTemplateModal(true); setTemplateName(''); }}
    className="mt-3 bg-gray-800 border border-gray-700 rounded-xl py-3.5 items-center"
  >
    <Text className="text-gray-300 font-medium text-base">Save as Template</Text>
  </Pressable>
  ```

- [ ] **Step 7: Add template picker to New Session modal**

  In the New Session modal JSX (around line 885), after the Notes field and before the "Create Session" button, add a template picker row that is hidden when no templates exist:

  ```tsx
  {templates.length > 0 && (
    <View>
      <Text className={labelCls}>From template (optional)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-2">
        <Pressable
          onPress={() => setSelectedTemplateId('')}
          className={`px-3 py-1.5 rounded-lg mr-2 ${selectedTemplateId === '' ? 'bg-violet-600' : 'bg-gray-800 border border-gray-700'}`}
        >
          <Text className={`text-sm ${selectedTemplateId === '' ? 'text-white' : 'text-gray-400'}`}>None</Text>
        </Pressable>
        {templates.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setSelectedTemplateId(t.id)}
            className={`px-3 py-1.5 rounded-lg mr-2 ${selectedTemplateId === t.id ? 'bg-violet-600' : 'bg-gray-800 border border-gray-700'}`}
          >
            <Text className={`text-sm ${selectedTemplateId === t.id ? 'text-white' : 'text-gray-400'}`}>{t.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )}
  ```

- [ ] **Step 8: Add the template name-input modal**

  Add this modal as a sibling to the existing modals (after the Shopping List modal, before the closing `</ScrollView>`):

  ```tsx
  {/* Template name modal */}
  <Modal visible={templateModal} animationType="fade" transparent>
    <View className="flex-1 bg-black/60 items-center justify-center px-6">
      <View className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full">
        <Text className="text-white font-semibold text-base mb-4">Save as Template</Text>
        <TextInput
          className={inputCls}
          value={templateName}
          onChangeText={setTemplateName}
          placeholder="Template name"
          placeholderTextColor="#4b5563"
          autoFocus
        />
        <View className="flex-row gap-3 mt-4">
          <Pressable
            onPress={() => setTemplateModal(false)}
            className="flex-1 bg-gray-800 rounded-xl py-3 items-center"
          >
            <Text className="text-gray-400 font-medium">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={saveAsTemplate}
            className="flex-1 bg-violet-600 rounded-xl py-3 items-center"
          >
            <Text className="text-white font-semibold">Save</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>
  ```

- [ ] **Step 9: Add Templates section to `SettingsScreen.tsx`**

  In `SettingsScreen.tsx`:

  1. Add state at the top of the component:
     ```ts
     const [templates, setTemplates] = useState<{ id: string; name: string; created_at: string }[]>([]);
     ```

  2. Add a load function and call it in `useEffect`:
     ```ts
     useEffect(() => {
       const prefs = loadPrefs();
       setDateFormat(prefs.dateFormat);
       setAccentColor(prefs.accentColor);
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
     ```

  3. Add the Templates section in the JSX, after the Date Format section and before the Accent Color section:
     ```tsx
     {templates.length > 0 && (
       <View className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
         <Text className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Templates</Text>
         {templates.map((t) => (
           <View key={t.id} className="flex-row items-center justify-between py-2 border-b border-gray-800 last:border-b-0">
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
     ```

- [ ] **Step 10: Type-check**

  ```bash
  cd app && npx tsc --noEmit
  ```

  Expected: zero errors. Fix any type errors only in the files modified by this task.

- [ ] **Step 11: Manual smoke test**

  1. Create a session with 2 regimens, each with phases.
  2. Tap the pencil icon to open Edit Session. Tap "Save as Template". Enter name "Test Template". Tap Save. Confirm the alert appears.
  3. Go to Settings. Scroll to the Templates section. "Test Template" must appear with a date.
  4. Tap "+ New" session. Confirm the template picker row appears with "None" selected and "Test Template" as an option.
  5. Select "Test Template". Fill in dates. Tap Create Session. The new session must open automatically with 2 regimens already populated (same supplement_id, same phases).
  6. Return to Settings -> Templates. Tap Delete on "Test Template". Confirm it is removed.
  7. Tap "+ New" session again. The template picker row must be gone (no templates exist).

- [ ] **Step 12: Commit**

  ```bash
  cd app && git add src/screens/RegimensScreen.tsx src/screens/SettingsScreen.tsx
  git commit -m "feat(app): add session templates -- save, apply, and manage via Settings"
  ```

---

## Task 6: Close Off TODO.md

Mark all confirmed-done items in `app/TODO.md` so the file accurately reflects the current state.

**Files:**
- Modify: `app/TODO.md`

- [ ] **Step 1: Update the "Needs Fixing" section**

  Mark all three items as fixed:
  ```markdown
  - [x] Adherence calendar -- timezone bug fixed (todayISO and isoDate now use local date)
  - [x] Push notifications -- handler registered at startup; tap auto-logs dose
  - [x] Backup & restore -- restore now uses withExclusiveTransactionAsync for atomicity
  ```

- [ ] **Step 2: Mark the confirmed-done items in all sections**

  In **Phase Editor**, mark these as done (they are already implemented in the code):
  ```markdown
  - [x] Phase coverage indicator
  - [x] Duration display in weeks ("4wk") when divisible by 7
  - [x] Dosage label: "/dose" instead of "/day"
  - [x] Day labels: "Su Mo Tu We Th Fr Sa"
  ```

  In **Supplements**, mark these as done:
  ```markdown
  - [x] Drops per ml field in supplement form
  - [x] Drops inventory display: "X drops (approx Y ml)" conversion
  - [x] Reorder alert -- threshold + units mode + "low" badge on card
  - [x] Unit-aware bottle label
  - [x] Delete supplement from inside edit modal
  ```

  In **Shortfall / Calculation**, mark done:
  ```markdown
  - [x] Show "X days short" in shortfall alert
  ```

  In **Settings**, mark done:
  ```markdown
  - [x] Backup & restore
  - [x] Color scheme / accent color preference
  ```

  In **Regimen / Session**, mark done:
  ```markdown
  - [x] Session templates -- save as template, create new session from template
  ```

  In **Dose Logging**, mark done:
  ```markdown
  - [x] Notification tap -> auto-log dose
  ```

- [ ] **Step 3: Commit**

  ```bash
  cd app && git add TODO.md
  git commit -m "docs(app): update TODO.md -- mark all confirmed-done and newly-fixed items complete"
  ```

---

## Final Verification

After all tasks are committed:

- [ ] Run a full type-check across the app:
  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] Start the app and do a full flow:
  1. Add a supplement
  2. Create a session, set dates
  3. Add a regimen to the session, add a phase
  4. Tap Calculate -- verify shortfall result shows correctly
  5. Log today's dose as taken
  6. Check the adherence calendar -- today's dot must match the device calendar date
  7. Export backup, clear all data, restore -- verify data is back
  8. Save session as template, create new session from template -- verify regimens pre-populate
  9. Set a reminder, wait for it, tap the notification -- verify dose is logged
