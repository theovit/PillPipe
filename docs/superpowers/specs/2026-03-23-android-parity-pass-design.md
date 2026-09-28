# Design: PillPipe Android App - Parity Pass

**Date:** 2026-03-23
**Scope:** `app/` only — no changes to `client/`, `server/`, or `db/`
**Status:** Approved

---

## Context

The PillPipe Android app (`app/`) has significant scaffolding already in place. A code audit against `app/TODO.md` revealed that many items listed as missing are already implemented in the current source. The actual remaining work is 4 bugs and 1 missing feature.

### Items confirmed already implemented (close off in TODO.md)

The following TODO items are fully coded and do not require implementation:

- Drops per ml field in supplement form (SupplementsScreen lines 265-278)
- Drops inventory display ("X drops (approx Y ml)")
- Reorder alert threshold and "low" badge (units mode)
- Unit-aware bottle label
- Delete supplement inside edit modal
- Phase coverage indicator (RegimensScreen lines 769-797)
- Duration display in weeks ("4wk")
- Dosage label "/dose"
- Day labels "Su Mo Tu We Th Fr Sa"
- "X days short" in shortfall result (RegimensScreen line 872)
- Backup and restore UI (export and import both complete)
- Accent color preference in Settings

---

## Work Items

### Bug 1 - Timezone drift breaks adherence calendar

**Root cause:** `todayISO()` in `app/src/utils/dates.ts` calls `new Date().toISOString().slice(0, 10)`, which returns the UTC date. The `isoDate()` helper in `AdherenceCalendar.tsx` has the same issue. In any timezone behind UTC, after the daily crossover point (e.g., 7 PM in UTC-5), these functions return tomorrow's local date. The adherence calendar's 30-day window shifts and the "today" dot lands on the wrong cell.

**Files affected:**
- `app/src/utils/dates.ts` - `todayISO()` and `daysFromNow()`
- `app/src/components/AdherenceCalendar.tsx` - `isoDate()` helper

**Fix:** Replace all `toISOString().slice(0, 10)` calls with a local-date formatter using `getFullYear()`, `getMonth() + 1`, `getDate()` padded to 2 digits. No API changes - same function signatures, same return type (`YYYY-MM-DD` string).

```ts
// Before (UTC-based, wrong in non-UTC timezones)
return new Date().toISOString().slice(0, 10);

// After (local-date, always matches device calendar)
const d = new Date();
const y = d.getFullYear();
const m = String(d.getMonth() + 1).padStart(2, '0');
const day = String(d.getDate()).padStart(2, '0');
return `${y}-${m}-${day}`;
```

**Validation:** After fix, the dot labeled "today" must match the device's current local calendar date regardless of timezone offset.

---

### Bug 2 - Notification handler not registered at app startup

**Root cause:** `Notifications.setNotificationHandler(...)` is called at module level in `app/src/utils/notifications.ts`. It only executes when the module is first imported, which happens inside `RegimensScreen.tsx`. If the app cold-starts with the Supplements or Settings tab active, `RegimensScreen` has not mounted and the module has not been imported. Any notification that fires before the user navigates to Regimens will not display.

**Files affected:**
- `app/App.tsx`

**Fix:** Add a bare import at the top of `App.tsx`:
```ts
import '@/utils/notifications';
```

Note: the `@/` alias resolves to `app/src/` (confirmed by existing imports in `App.tsx` such as `@/screens/RegimensScreen`). This import resolves to `app/src/utils/notifications.ts`.

This guarantees the module-level `setNotificationHandler` runs during app initialization before any navigation renders.

**Validation:** Cold-start the app on the Settings tab. Fire a test notification. It must display as an alert.

---

### Bug 3 - Notification tap does not log the dose

**Root cause:** No `addNotificationResponseReceivedListener` exists anywhere in the app. When the user taps a reminder notification, the app opens but no dose is logged.

**Files affected:**
- `app/App.tsx`

**Fix:** In `App.tsx`, add the following imports at the top (they are not currently present):

```ts
import { todayISO } from '@/utils/dates';
import { uuid, getDb } from '@/db/database';
```

Then add a listener inside a `useEffect` at the root component level. The listener callback cannot be `async` (expo-notifications API constraint), so an async IIFE is used to match the project's standard DB call pattern:

```ts
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
```

The dose is silently upserted. No UI feedback is needed in the listener - when the user opens the app and navigates to Regimens, the dose log will already reflect "taken."

**Validation:** Set a test reminder 1 minute from now. Wait for it. Tap the notification. Open the app and confirm the regimen shows "Taken today."

---

### Bug 4 - Backup restore uses unreliable multi-statement execAsync

**Root cause:** `importBackup` in `SettingsScreen.tsx` calls:
```ts
await db.execAsync(`
  DELETE FROM dose_log;
  DELETE FROM phases;
  ...
`);
```
`execAsync` does not guarantee multi-statement execution across all Android SQLite versions. If it stops after the first statement, later inserts from the backup file collide with stale rows.

**Files affected:**
- `app/src/screens/SettingsScreen.tsx`

**Fix:** Wrap the entire restore operation -- both the DELETEs and all INSERT loops -- in a single `withExclusiveTransactionAsync` call. This gives stronger ordering guarantees than `withTransactionAsync` (which can be interrupted by concurrent async queries). During a user-initiated restore, `withExclusiveTransactionAsync` ensures no other app code can interleave DB writes mid-restore.

Note: `withExclusiveTransactionAsync` passes a `txn` object to its callback. All queries inside must be called on `txn`, not `db`.

```ts
await db.withExclusiveTransactionAsync(async (txn) => {
  await txn.runAsync('DELETE FROM dose_log');
  await txn.runAsync('DELETE FROM phases');
  await txn.runAsync('DELETE FROM regimens');
  await txn.runAsync('DELETE FROM sessions');
  await txn.runAsync('DELETE FROM supplements');

  for (const row of (data.supplements ?? [])) {
    const keys = Object.keys(row).join(',');
    const placeholders = Object.keys(row).map(() => '?').join(',');
    await txn.runAsync(`INSERT OR IGNORE INTO supplements (${keys}) VALUES (${placeholders})`, Object.values(row) as any[]);
  }
  // ... repeat for sessions, regimens, phases, dose_log
});
```

If any delete or insert fails, the transaction rolls back and the database is left unchanged.

**Validation:** Export a backup with known data. Clear all data. Restore from the backup. Verify all rows are present and counts match.

---

### Feature - Session templates

**What it is:** Save a session (its regimens and phase structure) as a named template. When creating a new session, optionally pick a template to pre-populate regimens and phases. Manage (view, delete) templates in Settings.

**DB migration** (added to `migrate()` in `database.ts`):

```sql
CREATE TABLE IF NOT EXISTS session_templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

`data` is a JSON string with shape:
```json
{
  "regimens": [
    {
      "supplement_id": "...",
      "notes": "...",
      "phases": [
        { "dosage": 2, "duration_days": 30, "days_of_week": null, "indefinite": 0, "sequence_order": 0 }
      ]
    }
  ]
}
```

`reminder_time` is intentionally excluded from the template snapshot. Times are personal to each session instance.

**UI changes in RegimensScreen.tsx:**

1. Edit Session modal gets a "Save as template" button (below Save Changes, above Duplicate). Tapping it opens a single-field modal (name input). On confirm, the current session's regimens and their phases are serialized to JSON and inserted into `session_templates`.

2. New Session modal gets a "From template" row. It shows a dropdown/picker listing template names. When a template is selected, the new session is created, then the template's regimens and phases are cloned into it (new IDs, preserving supplement_id, notes, phase structure). The "From template" row is hidden when no templates exist.

**UI changes in SettingsScreen.tsx:**

A new "Templates" section lists all saved templates (name + created date). Each row has a delete button. The section is hidden when the table is empty.

**Data flow:**

```
Save as template:
  user taps "Save as template"
  -> name input modal
  -> on confirm: fetch regimens for session -> fetch phases for each regimen
  -> serialize to JSON
  -> INSERT INTO session_templates

Apply template:
  user selects template in New Session modal
  -> on Create: insert session row
  -> parse template data JSON
  -> for each regimen in template: insert regimen (new uuid, new session_id)
  -> for each phase in regimen: insert phase (new uuid, new regimen_id)
  -> open session
```

**Constraints:**
- Templates are local to the device. Not included in backup/restore in this iteration (can be added later). The existing export function queries specific named tables (`supplements`, `sessions`, `regimens`, `phases`, `dose_log`) and does not need modification -- `session_templates` is not in that list, so exclusion is automatic.
- A template does not validate that its supplement_ids still exist. If a supplement was deleted, creating from template skips that regimen silently (using INSERT OR IGNORE or a pre-check).

---

## Files Changed

| File | Change |
|---|---|
| `app/src/utils/dates.ts` | Fix `todayISO()` and `daysFromNow()` to use local date |
| `app/src/components/AdherenceCalendar.tsx` | Fix `isoDate()` helper to use local date |
| `app/App.tsx` | Add bare `notifications` import; add notification tap listener |
| `app/src/screens/SettingsScreen.tsx` | Fix restore transaction; add Templates section |
| `app/src/screens/RegimensScreen.tsx` | Add "Save as template" button; add template picker in New Session modal |
| `app/src/db/database.ts` | Add `session_templates` table to migration |
| `app/TODO.md` | Mark all confirmed-done items as complete; add template as done when shipped |

---

## Out of Scope

- iOS-specific behavior
- Google Drive backup (web-only feature, intentionally excluded)
- Multi-session open simultaneously (N/A on mobile, single-open is correct)
- PDF export (low priority, not included)
- Dark/light mode toggle (accent color is sufficient for this pass)
- Meal-time dosing slots (P1 feature in FEATURES.md, separate spec)
