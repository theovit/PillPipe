# PillPipe: Phase Time of Day Refactor — Design Spec
**Date:** 2026-03-24
**Status:** Approved

---

## Overview

Replace the single `dosage` field on phases with four time-of-day dose fields (Morning, Lunch, Dinner, Custom). Update the Phase Editor UI to match. Add a "Days Left" countdown to the active phase in each regimen card. Update the calculator to use the new fields for pill count calculations.

---

## Section 1 — Database Schema Migration

### New columns

Add five columns to the existing `phases` table via `ALTER TABLE` in `migrate()` in `app/src/db/database.ts`. Each call is a separate `execAsync`:

```sql
ALTER TABLE phases ADD COLUMN dose_morning REAL NOT NULL DEFAULT 0;
ALTER TABLE phases ADD COLUMN dose_lunch   REAL NOT NULL DEFAULT 0;
ALTER TABLE phases ADD COLUMN dose_dinner  REAL NOT NULL DEFAULT 0;
ALTER TABLE phases ADD COLUMN dose_custom  REAL NOT NULL DEFAULT 0;
ALTER TABLE phases ADD COLUMN custom_time  TEXT;
```

`ALTER TABLE ... ADD COLUMN` is idempotent-safe when wrapped in a try/catch — if the column already exists, SQLite throws a "duplicate column" error which should be swallowed silently.

### Data migration

After adding the columns, copy existing `dosage` values into `dose_morning` for rows that have not yet been migrated:

```sql
UPDATE phases SET dose_morning = dosage WHERE dose_morning = 0 AND dosage > 0;
```

### Retention of `dosage` column

The old `dosage` column is retained (not dropped). SQLite `DROP COLUMN` has edge cases with existing triggers and indices; since all apps in the wild have this column, removing it risks migration failures. The column is ignored by the app going forward. New phases written by the app will leave `dosage` at its default value (0).

---

## Section 2 — TypeScript Type Updates

**File:** `app/src/utils/types.ts`

Update the `Phase` interface:

```ts
export interface Phase {
  id: string;
  regimen_id: string;
  dosage: number;          // legacy — retained for DB compatibility, not used in UI
  dose_morning: number;
  dose_lunch: number;
  dose_dinner: number;
  dose_custom: number;
  custom_time: string | null;  // "HH:MM", only populated when dose_custom > 0
  duration_days: number;
  days_of_week: string | null;
  indefinite: number;
  sequence_order: number;
  created_at: string;
}
```

---

## Section 3 — Phase Editor UI

**File:** `app/src/screens/RegimensScreen.tsx`

### New state variables

Replace `phaseDosage` with five new vars (add alongside existing phase modal state):

```ts
const [phaseMorning, setPhaseMorning] = useState('0');
const [phaseLunch, setPhaseLunch] = useState('0');
const [phaseDinner, setPhaseDinner] = useState('0');
const [phaseCustom, setPhaseCustom] = useState('0');
const [phaseCustomTime, setPhaseCustomTime] = useState('12:00');
const [showPhaseCustomPicker, setShowPhaseCustomPicker] = useState(false);
```

Remove: `phaseDosage` / `setPhaseDosage`.

### Modal population (`openPhaseModal`)

When opening for an existing phase, populate new state:
```ts
setPhaseMorning(String(p.dose_morning));
setPhaseLunch(String(p.dose_lunch));
setPhaseDinner(String(p.dose_dinner));
setPhaseCustom(String(p.dose_custom));
setPhaseCustomTime(p.custom_time ?? '12:00');
```

When opening for a new phase, reset all to `'0'` and `phaseCustomTime` to `'12:00'`.

### Phase Editor JSX

Replace the single dosage input row with four rows:

```tsx
{/* Morning */}
<View className="flex-row items-center justify-between py-2 border-b border-gray-700/50">
  <Text className="text-gray-300 text-sm w-20">Morning</Text>
  <TextInput
    value={phaseMorning}
    onChangeText={setPhaseMorning}
    keyboardType="decimal-pad"
    className="bg-gray-800 text-white text-sm rounded px-3 py-1.5 w-20 text-right"
  />
  <Text className="text-gray-500 text-sm ml-2">{phaseUnit}</Text>
</View>

{/* Lunch */}
<View className="flex-row items-center justify-between py-2 border-b border-gray-700/50">
  <Text className="text-gray-300 text-sm w-20">Lunch</Text>
  <TextInput
    value={phaseLunch}
    onChangeText={setPhaseLunch}
    keyboardType="decimal-pad"
    className="bg-gray-800 text-white text-sm rounded px-3 py-1.5 w-20 text-right"
  />
  <Text className="text-gray-500 text-sm ml-2">{phaseUnit}</Text>
</View>

{/* Dinner */}
<View className="flex-row items-center justify-between py-2 border-b border-gray-700/50">
  <Text className="text-gray-300 text-sm w-20">Dinner</Text>
  <TextInput
    value={phaseDinner}
    onChangeText={setPhaseDinner}
    keyboardType="decimal-pad"
    className="bg-gray-800 text-white text-sm rounded px-3 py-1.5 w-20 text-right"
  />
  <Text className="text-gray-500 text-sm ml-2">{phaseUnit}</Text>
</View>

{/* Custom */}
<View className="flex-row items-center justify-between py-2 border-b border-gray-700/50">
  <Text className="text-gray-300 text-sm w-20">Custom</Text>
  <TextInput
    value={phaseCustom}
    onChangeText={setPhaseCustom}
    keyboardType="decimal-pad"
    className="bg-gray-800 text-white text-sm rounded px-3 py-1.5 w-20 text-right"
  />
  <Text className="text-gray-500 text-sm ml-2">{phaseUnit}</Text>
</View>

{/* Custom time picker — only shown when dose_custom > 0 */}
{parseFloat(phaseCustom) > 0 && (
  <Pressable
    onPress={() => setShowPhaseCustomPicker(true)}
    className="flex-row items-center justify-between py-2 border-b border-gray-700/50"
  >
    <Text className="text-gray-500 text-xs ml-20">Custom time</Text>
    <Text className="text-violet-400 text-sm font-mono">{phaseCustomTime}</Text>
  </Pressable>
)}
{showPhaseCustomPicker && (
  <DateTimePicker
    value={new Date(`1970-01-01T${phaseCustomTime}:00`)}
    mode="time"
    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
    onChange={(_, date) => {
      setShowPhaseCustomPicker(false);
      if (date) {
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        setPhaseCustomTime(`${hh}:${mm}`);
      }
    }}
  />
)}
```

### Validation

At least one dose field must be > 0:
```ts
const morning = parseFloat(phaseMorning) || 0;
const lunch = parseFloat(phaseLunch) || 0;
const dinner = parseFloat(phaseDinner) || 0;
const custom = parseFloat(phaseCustom) || 0;
if (morning + lunch + dinner + custom <= 0) {
  Alert.alert('Enter at least one dose');
  return;
}
```

### Save (`savePhase`)

```ts
await db.runAsync(
  `UPDATE phases SET dose_morning=?, dose_lunch=?, dose_dinner=?, dose_custom=?, custom_time=?,
   duration_days=?, days_of_week=?, indefinite=? WHERE id=?`,
  [morning, lunch, dinner, custom, custom > 0 ? phaseCustomTime : null,
   dur, daysJson, phaseIndefinite ? 1 : 0, editingPhase.id],
);
// INSERT (new phase):
await db.runAsync(
  `INSERT INTO phases (id,regimen_id,dosage,dose_morning,dose_lunch,dose_dinner,dose_custom,
   custom_time,duration_days,days_of_week,indefinite,sequence_order)
   VALUES (?,?,0,?,?,?,?,?,?,?,?,?)`,
  [uuid(), phaseRegimenId, morning, lunch, dinner, custom,
   custom > 0 ? phaseCustomTime : null, dur, daysJson, phaseIndefinite ? 1 : 0, nextOrder],
);
```

---

## Section 4 — Phase Label

**File:** `app/src/screens/RegimensScreen.tsx`

Update `phaseLabel()` to summarise the four dose fields:

```ts
function phaseLabel(p: Phase, unit: string): string {
  const parts: string[] = [];
  if (p.dose_morning > 0) parts.push(`${fmtAmount(p.dose_morning, unit)} morning`);
  if (p.dose_lunch   > 0) parts.push(`${fmtAmount(p.dose_lunch,   unit)} lunch`);
  if (p.dose_dinner  > 0) parts.push(`${fmtAmount(p.dose_dinner,  unit)} dinner`);
  if (p.dose_custom  > 0) parts.push(`${fmtAmount(p.dose_custom,  unit)} @ ${p.custom_time ?? '?'}`);
  const doseStr = parts.length > 0 ? parts.join(' · ') : '0 doses';
  const isIndef = p.indefinite === 1;
  const dur = isIndef ? '∞' : phaseDurLabel(p.duration_days);
  const dow = p.days_of_week ? JSON.parse(p.days_of_week) as number[] : null;
  const dowStr = dow && dow.length > 0 && dow.length < 7
    ? ' · ' + dow.map((d) => DOW_LABELS[d]).join(' ')
    : '';
  return `${doseStr} · ${dur}${dowStr}`;
}
```

---

## Section 5 — Active Phase Countdown

**File:** `app/src/screens/RegimensScreen.tsx`

### Helper function

Add a pure helper that classifies phases given session `start_date` and today:

```ts
type PhaseStatus = { status: 'completed' | 'active' | 'upcoming'; daysLeft: number | null };

function getPhaseStatus(phase: Phase, allPhases: Phase[], sessionStartDate: string): PhaseStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(sessionStartDate);
  start.setHours(0, 0, 0, 0);

  // Walk phases in sequence_order to find each phase's start day offset
  const sorted = [...allPhases].sort((a, b) => a.sequence_order - b.sequence_order);
  let dayOffset = 0;
  for (const p of sorted) {
    const phaseStart = new Date(start);
    phaseStart.setDate(phaseStart.getDate() + dayOffset);
    const phaseEnd = new Date(phaseStart);
    phaseEnd.setDate(phaseEnd.getDate() + (p.indefinite === 1 ? 99999 : p.duration_days));

    if (p.id === phase.id) {
      if (today < phaseStart) return { status: 'upcoming', daysLeft: null };
      if (today >= phaseEnd && p.indefinite !== 1) return { status: 'completed', daysLeft: 0 };
      const msLeft = phaseEnd.getTime() - today.getTime();
      const daysLeft = p.indefinite === 1 ? null : Math.ceil(msLeft / 86400000);
      return { status: 'active', daysLeft };
    }
    dayOffset += p.indefinite === 1 ? 0 : p.duration_days;
  }
  return { status: 'upcoming', daysLeft: null };
}
```

### Phase row rendering

Update the phase list in the regimen card to use `getPhaseStatus`:

```tsx
{regimenPhases.map((p, idx) => {
  const { status, daysLeft } = openSess
    ? getPhaseStatus(p, regimenPhases, openSess.start_date)
    : { status: 'upcoming' as const, daysLeft: null };
  return (
    <View key={p.id} className="flex-row items-center gap-2 mb-1.5">
      <Pressable onPress={() => openPhaseModal(r.id, unit, p)} className="flex-row items-center gap-2 flex-1">
        <View className="w-5 h-5 rounded-full bg-violet-900/60 border border-violet-700/50 items-center justify-center">
          <Text className="text-violet-400 text-xs font-bold">{idx + 1}</Text>
        </View>
        <Text className={`text-xs flex-1 ${status === 'completed' ? 'line-through text-gray-600' : status === 'upcoming' ? 'text-gray-600' : 'text-gray-300'}`}>
          {phaseLabel(p, unit)}
        </Text>
        {status === 'active' && (
          <View className="bg-violet-900/60 border border-violet-700/50 rounded px-1.5 py-0.5">
            <Text className="text-violet-300 text-xs font-mono">
              {daysLeft === null ? '∞' : `${daysLeft}d`}
            </Text>
          </View>
        )}
        {status === 'completed' && <Text className="text-gray-600 text-xs">✓</Text>}
        <Text className="text-gray-600 text-xs">✎</Text>
      </Pressable>
      <Pressable onPress={() => deletePhase(p.id)} hitSlop={8}>
        <Text className="text-red-700 text-xs px-1">✕</Text>
      </Pressable>
    </View>
  );
})}
```

Note: Inside the `regimens.map()` render block, the open session is available as `openSess` (declared just above the `return` statement). Use `openSess` — there is no local variable named `session` at this scope. If `openSess` is undefined (no open session), all phases show as upcoming.

---

## Section 6 — Calculator Update

**File:** `app/src/engine/calculator.ts`

The calculator defines its own local `Phase` interface (separate from `types.ts`). Add the four new dose fields to it:

```ts
interface Phase {
  // existing fields ...
  dose_morning: number;
  dose_lunch:   number;
  dose_dinner:  number;
  dose_custom:  number;
  // dosage retained for legacy compatibility
}
```

Then wherever `p.dosage` is used to compute daily pill counts (one location), replace with the sum:

```ts
// Before:
const dailyDose = Number(phase.dosage);

// After:
const dailyDose = phase.dose_morning + phase.dose_lunch + phase.dose_dinner + phase.dose_custom;
```

This keeps shortfall, bottles needed, and estimated cost calculations correct.

---

## File Changelist

| File | Change |
|---|---|
| `app/src/db/database.ts` | Add 5 `ALTER TABLE` calls + `UPDATE` data migration in `migrate()` |
| `app/src/utils/types.ts` | Add 5 new fields to `Phase` interface |
| `app/src/screens/RegimensScreen.tsx` | Replace `phaseDosage` state with 5 new vars; update `openPhaseModal`; replace dosage input with 4-field UI + custom time picker; update `savePhase`; update `phaseLabel`; add `getPhaseStatus` helper; update phase row rendering; update `saveAsTemplate`/`applyTemplate` column lists |
| `app/src/engine/calculator.ts` | Add four dose fields to local `Phase` interface; replace `p.dosage` with sum |

---

## Section 7 — Template Snapshot Update

**File:** `app/src/screens/RegimensScreen.tsx`

`saveAsTemplate()` contains a hard-coded query that snapshots phase columns:

```ts
// Current (must be updated):
SELECT dosage, duration_days, days_of_week, indefinite, sequence_order FROM phases
```

Update to include all new dose fields:

```ts
SELECT dosage, dose_morning, dose_lunch, dose_dinner, dose_custom, custom_time,
       duration_days, days_of_week, indefinite, sequence_order FROM phases
```

Also update the corresponding `applyTemplate()` INSERT statement to include the new columns:

```ts
// Updated INSERT in applyTemplate():
await db.runAsync(
  `INSERT INTO phases (id, regimen_id, dosage, dose_morning, dose_lunch, dose_dinner, dose_custom,
   custom_time, duration_days, days_of_week, indefinite, sequence_order)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [uuid(), regimenId, row.dosage, row.dose_morning, row.dose_lunch, row.dose_dinner,
   row.dose_custom, row.custom_time, row.duration_days, row.days_of_week,
   row.indefinite, row.sequence_order],
);
```

Without this, templates saved after migration will restore phases with all dose fields zeroed out — silent data loss.

---

## Out of Scope

- Notification auto-sync based on phase dosages (next sprint)
- Web app parity for phase time-of-day fields
- Dropping the legacy `dosage` column
- Per-phase start date storage
