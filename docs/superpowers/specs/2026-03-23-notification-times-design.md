# PillPipe: Notification Times Sprint — Design Spec
**Date:** 2026-03-23
**Status:** Approved

---

## Overview

This sprint delivers:
1. Fix the reminder crash (`DateTimePicker` missing import → replaced by full removal)
2. Multi-slot notification times per regimen (Morning / Lunch / Dinner / Custom, all independently active)
3. Global preset times configurable in Settings
4. Tailwind font-size rem binding fix
5. CSV export verification (likely already fixed by prior `database.ts` stampede fix)

---

## Section 1 — Bug Fix: Reminder Crash

**Root cause:** `DateTimePicker` is rendered in `RegimensScreen.tsx` (the old reminder time picker row) but the import `import DateTimePicker from '@react-native-community/datetimepicker'` is missing. This causes a native crash ("Property timePicker doesn't exist") on Android.

**Resolution:** The old single-time reminder system is fully removed and replaced by the new multi-slot notification system. The fix is code removal, not a patch.

**Removed from `RegimensScreen.tsx`:**
- `reminderTimes` state (`Record<string, string>`)
- `showReminderPicker` state (`string | null`)
- `saveReminderTime()` function
- The reminder row JSX (tappable `Reminder: none` text + inline `DateTimePicker`)
- The `import * as SQLite from 'expo-sqlite'` orphan import (unused since `getDb` refactor)

---

## Section 2 — Database Schema

### New table: `regimen_notifications`

Added to `migrate()` in `app/src/db/database.ts` as a new `execAsync` call:

```sql
CREATE TABLE IF NOT EXISTS regimen_notifications (
  id          TEXT PRIMARY KEY,
  regimen_id  TEXT NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('morning','lunch','dinner','custom')),
  custom_time TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

- `type` determines which preset time to use (`morning`→`prefs.morningTime`, etc.) or `custom`→`custom_time`
- `custom_time` is `"HH:MM"` format, only populated when `type = 'custom'`
- Cascades on regimen delete — DB rows cleaned up automatically; **OS notification cancellation must happen before the DB delete** (see Section 6)
- A partial unique index prevents duplicate preset slots:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_regimen_notif_preset
    ON regimen_notifications(regimen_id, type)
    WHERE type != 'custom';
  ```
  Added immediately after the `regimen_notifications` table creation in `migrate()`.
- `reminder_time` column on `regimens` is retained (no-op, not written to) — SQLite migration cost not justified
- Row `id` is generated with the existing `uuid()` helper from `database.ts`
- `PRAGMA foreign_keys = ON` is already enforced in `database.ts` `_initDb()` — CASCADE will function correctly

### `RegNotif` type (new, in `types.ts`)

```ts
export interface RegNotif {
  id: string;
  regimen_id: string;
  type: 'morning' | 'lunch' | 'dinner' | 'custom';
  custom_time: string | null;
}
```

---

## Section 3 — AppPrefs

`app/src/utils/prefs.ts` gains three new fields:

```ts
morningTime: string;  // default: '08:00'
lunchTime:   string;  // default: '12:00'
dinnerTime:  string;  // default: '18:00'
```

`DEFAULT` object updated accordingly. `loadPrefs()` / `savePrefs()` are unchanged (they merge with defaults automatically).

---

## Section 4 — Notifications Utility

`app/src/utils/notifications.ts` replaces `scheduleReminder` / `cancelReminder` with:

### Notification identifiers

- Preset slots use deterministic identifiers: `reminder-{regimenId}-morning`, `reminder-{regimenId}-lunch`, `reminder-{regimenId}-dinner`
- Custom slots use the row PK: `reminder-{entryId}`

This makes cancellation unambiguous — preset identifiers are reconstructable from `regimenId` alone without querying the DB.

### `scheduleAllForRegimen(regimenId, supplementName, entries, prefs)`

1. Cancel the three fixed preset identifiers for this regimen
2. Cancel all custom identifiers by iterating entries where `type === 'custom'`
3. For each entry in `entries`: resolve time, schedule daily notification

```
identifier = type === 'custom'
               ? `reminder-${entry.id}`
               : `reminder-${regimenId}-${entry.type}`
time = type === 'custom' ? entry.custom_time : prefs[type + 'Time']
```

### `cancelAllForRegimen(regimenId, entryIds[])`

Cancels the three fixed preset identifiers plus each `reminder-{entryId}` in the provided list.
**Must be called before any DB delete** — caller fetches current entry IDs first if needed.

### `resolveTime(type, customTime, prefs): string`

Pure helper — returns `"HH:MM"` for a given entry. Used by scheduler and UI subtitle.

---

## Section 5 — Settings UI

File: `app/src/screens/SettingsScreen.tsx`

### New state
```ts
const [showTimePicker, setShowTimePicker] = useState<'morning'|'lunch'|'dinner'|null>(null);
```

### Changes to Notifications section

When permission is `granted`, add a "Reminder Times" subsection with three rows:

```
Morning    08:00  ›
Lunch      12:00  ›
Dinner     18:00  ›
```

Tapping a row sets `showTimePicker` to that type, showing a `DateTimePicker` in `mode="time"`. On change, saves to prefs via `savePrefs({ morningTime: ... })`. Shows an inline note: *"Applies to new reminders. Existing reminders update on next app open."*

The existing **Test Notification** button and permission request button are unchanged.

### Boot-time reschedule (`App.tsx`)

When preset times change in Settings, in-flight OS notifications still use old times until rescheduled. On app startup (inside the existing `initPrefs` effect in `App.tsx`), after prefs load:

```ts
// After initPrefs() resolves:
const prefs = loadPrefs();
const { status } = await Notifications.getPermissionsAsync();
if (status === 'granted') {
  const db = await getDb();
  const regimens = await db.getAllAsync<{ id: string; supplement_id: string }>(
    'SELECT id, supplement_id FROM regimens'
  );
  for (const r of regimens) {
    const entries = await db.getAllAsync<RegNotif>(
      'SELECT * FROM regimen_notifications WHERE regimen_id = ?', [r.id]
    );
    if (entries.length > 0) {
      const sup = await db.getFirstAsync<{ name: string }>(
        'SELECT name FROM supplements WHERE id = ?', [r.supplement_id]
      );
      await scheduleAllForRegimen(r.id, sup?.name ?? 'supplement', entries, prefs);
    }
  }
}
```

This ensures all reminders reflect the current preset times after settings changes.

---

## Section 6 — Regimen Card UI

File: `app/src/screens/RegimensScreen.tsx`

### New state

```ts
const [notifEntries, setNotifEntries] = useState<Record<string, RegNotif[]>>({});
const [showCustomTimePicker, setShowCustomTimePicker] = useState<string | null>(null); // regimenId
```

### Loading

In `openSession()` and `reloadOpenSession()`, after loading phases, load notification entries:

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

### Notification entry mutations

- **Toggle preset** (`togglePresetNotif(regimenId, type)`): if entry exists → cancel its OS notification, delete DB row; if not → insert row, schedule notification.
- **Add custom** (`addCustomNotif(regimenId, time)`): insert row (`id = uuid()`) with `type='custom'`, `custom_time=time`; schedule notification.
- **Remove entry** (`removeNotif(regimenId, entryId, type)`): cancel OS notification by identifier, then delete DB row; reload entries.

**Regimen deletion order** (in `deleteRegimen`):
1. Fetch current entry IDs: `SELECT id FROM regimen_notifications WHERE regimen_id = ?`
2. Call `cancelAllForRegimen(regimenId, entryIds)`
3. Then `DELETE FROM regimens WHERE id = ?` (CASCADE removes DB rows)

All mutations use `getDb()` → `runAsync` with try/catch surfacing errors via `Alert`.

### Regimen card changes

Remove the old reminder row. Add a **Notifications** section below phases:

```
─────────────────────────────
Notifications
[ Morning · 8:00am ]  [ Lunch ]  [ Dinner ]  [ + Custom ]
  Custom · 2:30pm  ✕
  Custom · 7:00pm  ✕
```

- Morning / Lunch / Dinner: `Pressable` chips. Active = filled violet, inactive = gray outline. Subtitle shows resolved time when active.
- `+ Custom`: opens `DateTimePicker` in time mode (via `showCustomTimePicker` state). On confirm, calls `addCustomNotif`.
- Custom rows: `Custom · HH:MMam/pm  ✕`. Tapping ✕ calls `removeNotif`.
- `DateTimePicker` for custom time rendered inline when `showCustomTimePicker === r.id`.

---

## Section 7 — Font Size Fix

File: `app/tailwind.config.js`

NativeWind's built-in `text-*` classes compile to fixed pixel values. `rem.set()` in `App.tsx` only affects classes using rem units. Fix: configure explicit rem-based font sizes in the Tailwind theme extension:

```js
theme: {
  extend: {
    fontSize: {
      xs:   ['0.75rem',  { lineHeight: '1rem' }],
      sm:   ['0.875rem', { lineHeight: '1.25rem' }],
      base: ['1rem',     { lineHeight: '1.5rem' }],
      lg:   ['1.125rem', { lineHeight: '1.75rem' }],
      xl:   ['1.25rem',  { lineHeight: '1.75rem' }],
    },
  },
},
```

With these overrides, `rem.set(12)` (small), `rem.set(14)` (medium), `rem.set(16)` (large) will scale all text uniformly on next app start. `App.tsx` already calls `rem.set()` correctly — no other changes needed.

---

## Section 8 — CSV Export

`exportCSV()` in `RegimensScreen.tsx` makes no database calls — it reads `calcResults` and `regimens` from React state. The prior `prepareAsync` NPE (from the database.ts promise stampede) was fixed this session. No storage permission changes are needed; `expo-file-system` + `expo-sharing` use the system share sheet which does not require `WRITE_EXTERNAL_STORAGE`. **Verify on device post-deploy before adding any permission logic.**

---

## File Changelist

| File | Change |
|------|--------|
| `app/src/db/database.ts` | Add `regimen_notifications` table to `migrate()` |
| `app/src/utils/types.ts` | Add `RegNotif` interface |
| `app/src/utils/prefs.ts` | Add `morningTime`, `lunchTime`, `dinnerTime` to `AppPrefs` |
| `app/src/utils/notifications.ts` | Replace `scheduleReminder`/`cancelReminder` with `scheduleAllForRegimen`, `cancelAllForRegimen`, `resolveTime` |
| `app/src/screens/RegimensScreen.tsx` | Remove old reminder system; add `notifEntries` state; add notification section to regimen card |
| `app/src/screens/SettingsScreen.tsx` | Add Reminder Times subsection with three time pickers |
| `app/tailwind.config.js` | Add rem-based font size overrides |

---

## Out of Scope (This Sprint)

- Live reschedule of all regimens when a preset time changes in Settings (deferred to follow-up)
- PDF export
- Web app parity for Morning/Lunch/Dinner/Custom (tracked separately)
- `session_templates` in backup export (existing backlog item)
