# Phase Time of Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `dosage` field on phases with four time-of-day dose fields (Morning, Lunch, Dinner, Custom), update the Phase Editor UI, add an active-phase "Days Left" countdown, and keep the calculator and template system correct.

**Architecture:** DB migration adds 5 columns to `phases` via `ALTER TABLE`; existing `dosage` values migrate to `dose_morning`. Types, calculator, editor UI, phase labels, countdown display, and template snapshot queries all updated to use the new fields. The old `dosage` column is retained for DB compatibility but ignored by the app.

**Tech Stack:** Expo SDK 54, expo-sqlite, React Native, NativeWind 4, TypeScript, `@react-native-community/datetimepicker`

**Spec:** `docs/superpowers/specs/2026-03-24-phase-time-of-day-design.md`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `app/src/db/database.ts` | Modify | Add 5 `ALTER TABLE` + `UPDATE` migration calls at end of `migrate()` |
| `app/src/utils/types.ts` | Modify | Add 5 new fields to `Phase` interface |
| `app/src/engine/calculator.ts` | Modify | Add 4 new fields to local `Phase` interface; replace `phase.dosage` sum |
| `app/src/screens/RegimensScreen.tsx` | Modify | Phase modal state, `openPhaseModal`, `savePhase`, editor JSX, `phaseLabel`, `getPhaseStatus`, phase row rendering, `saveAsTemplate`, `applyTemplate` |

---

## Task 1: DB Schema Migration + Type Updates

**Files:**
- Modify: `app/src/db/database.ts`
- Modify: `app/src/utils/types.ts`
- Modify: `app/src/engine/calculator.ts`

- [ ] **Step 1: Add ALTER TABLE calls to `migrate()` in `database.ts`**

  Open `app/src/db/database.ts`. At the **end** of the `migrate()` function, after the last `execAsync` call (the unique index on `regimen_notifications`, currently the last statement), add:

  ```ts
  // Phase time-of-day columns — each wrapped in try/catch for idempotency
  // (ALTER TABLE throws "duplicate column name" if already exists)
  for (const sql of [
    'ALTER TABLE phases ADD COLUMN dose_morning REAL NOT NULL DEFAULT 0',
    'ALTER TABLE phases ADD COLUMN dose_lunch   REAL NOT NULL DEFAULT 0',
    'ALTER TABLE phases ADD COLUMN dose_dinner  REAL NOT NULL DEFAULT 0',
    'ALTER TABLE phases ADD COLUMN dose_custom  REAL NOT NULL DEFAULT 0',
    'ALTER TABLE phases ADD COLUMN custom_time  TEXT',
  ]) {
    try { await db.execAsync(sql); } catch { /* column already exists */ }
  }
  // Migrate existing single-dosage phases to dose_morning
  await db.execAsync(
    'UPDATE phases SET dose_morning = dosage WHERE dose_morning = 0 AND dosage > 0',
  );
  ```

- [ ] **Step 2: Update `Phase` interface in `types.ts`**

  Open `app/src/utils/types.ts`. Find the `Phase` interface (lines 41–50):
  ```ts
  export interface Phase {
    id: string;
    regimen_id: string;
    dosage: number;
    duration_days: number;
    days_of_week: string | null;
    indefinite: number;
    sequence_order: number;
    created_at: string;
  }
  ```

  Replace with:
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

- [ ] **Step 3: Update local `Phase` interface in `calculator.ts`**

  Open `app/src/engine/calculator.ts`. Find the local `Phase` interface (lines 1–8):
  ```ts
  export interface Phase {
    dosage: number;
    duration_days: number;
    /** JSON-encoded int[] stored in SQLite, e.g. "[1,3,5]" or null */
    days_of_week: string | null;
    indefinite: number | boolean; // SQLite stores boolean as 0/1
    sequence_order: number;
  }
  ```

  Replace with:
  ```ts
  export interface Phase {
    dosage: number;          // legacy — kept for backward compatibility
    dose_morning: number;
    dose_lunch: number;
    dose_dinner: number;
    dose_custom: number;
    duration_days: number;
    /** JSON-encoded int[] stored in SQLite, e.g. "[1,3,5]" or null */
    days_of_week: string | null;
    indefinite: number | boolean; // SQLite stores boolean as 0/1
    sequence_order: number;
  }
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd app && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: errors only where `phase.dosage` is still referenced in `calculator.ts` logic — fixed in Task 2.

- [ ] **Step 5: Commit**

  ```bash
  git add app/src/db/database.ts app/src/utils/types.ts app/src/engine/calculator.ts
  git commit -m "feat(app): add dose_morning/lunch/dinner/custom columns to phases schema"
  ```

---

## Task 2: Calculator Daily Dose Update

**Files:**
- Modify: `app/src/engine/calculator.ts` (line ~72)

- [ ] **Step 1: Replace `phase.dosage` with sum of four fields**

  Open `app/src/engine/calculator.ts`. Find line ~72:
  ```ts
  const dosage = Number(phase.dosage);
  ```

  Replace with:
  ```ts
  const dosage = phase.dose_morning + phase.dose_lunch + phase.dose_dinner + phase.dose_custom;
  ```

  This is the only place in the file where the per-phase daily dose is read. Lines 84, 85, 86, 89 use the `dosage` local variable derived from this — no further changes needed there.

- [ ] **Step 2: Verify TypeScript compiles clean**

  ```bash
  cd app && npx tsc --noEmit 2>&1 | head -20
  ```
  Expected: no errors in `calculator.ts`.

- [ ] **Step 3: Commit**

  ```bash
  git add app/src/engine/calculator.ts
  git commit -m "feat(app): calculator uses sum of time-of-day dose fields"
  ```

---

## Task 3: Phase Editor — State, Modal Population, Save, JSX

**Files:**
- Modify: `app/src/screens/RegimensScreen.tsx`

This is the largest task. Read the file carefully before editing.

- [ ] **Step 1: Replace `phaseDosage` state with five new vars**

  Find the phase editor state block (lines 98–106):
  ```ts
  const [phaseDosage, setPhaseDosage] = useState('');
  ```

  Replace that one line with:
  ```ts
  const [phaseMorning, setPhaseMorning] = useState('0');
  const [phaseLunch, setPhaseLunch] = useState('0');
  const [phaseDinner, setPhaseDinner] = useState('0');
  const [phaseCustom, setPhaseCustom] = useState('0');
  const [phaseCustomTime, setPhaseCustomTime] = useState('12:00');
  const [showPhaseCustomPicker, setShowPhaseCustomPicker] = useState(false);
  ```

- [ ] **Step 2: Update `openPhaseModal` to populate new state**

  Find `openPhaseModal` (lines 526–551). Replace:
  ```ts
  setPhaseDosage(String(existing.dosage));
  ```
  With:
  ```ts
  setPhaseMorning(String(existing.dose_morning));
  setPhaseLunch(String(existing.dose_lunch));
  setPhaseDinner(String(existing.dose_dinner));
  setPhaseCustom(String(existing.dose_custom));
  setPhaseCustomTime(existing.custom_time ?? '12:00');
  ```

  And in the `else` branch (new phase), replace:
  ```ts
  setPhaseDosage('');
  ```
  With:
  ```ts
  setPhaseMorning('0');
  setPhaseLunch('0');
  setPhaseDinner('0');
  setPhaseCustom('0');
  setPhaseCustomTime('12:00');
  setShowPhaseCustomPicker(false);
  ```

- [ ] **Step 3: Update `savePhase` validation and DB calls**

  Find `savePhase` (lines 553–585). Replace the entire function body with:

  ```ts
  async function savePhase() {
    const morning = parseFloat(phaseMorning) || 0;
    const lunch   = parseFloat(phaseLunch)   || 0;
    const dinner  = parseFloat(phaseDinner)  || 0;
    const custom  = parseFloat(phaseCustom)  || 0;
    if (morning + lunch + dinner + custom <= 0) {
      Alert.alert('Enter at least one dose');
      return;
    }
    const rawDur = parseInt(phaseDuration, 10);
    const dur = phaseIndefinite ? 9999 : (phaseDurationUnit === 'weeks' ? rawDur * 7 : rawDur);
    if (!phaseIndefinite && (isNaN(rawDur) || rawDur <= 0)) {
      Alert.alert('Enter a valid duration');
      return;
    }
    const daysJson = phaseDow.length > 0 ? JSON.stringify([...phaseDow].sort()) : null;
    const ct = custom > 0 ? phaseCustomTime : null;

    try {
      const db = await getDb();
      if (editingPhase) {
        await db.runAsync(
          'UPDATE phases SET dose_morning=?, dose_lunch=?, dose_dinner=?, dose_custom=?, custom_time=?, duration_days=?, days_of_week=?, indefinite=? WHERE id=?',
          [morning, lunch, dinner, custom, ct, dur, daysJson, phaseIndefinite ? 1 : 0, editingPhase.id],
        );
      } else {
        const rows = await db.getAllAsync<{ m: number | null }>(
          'SELECT MAX(sequence_order) as m FROM phases WHERE regimen_id=?',
          [phaseRegimenId],
        );
        const nextOrder = (rows[0]?.m ?? -1) + 1;
        await db.runAsync(
          'INSERT INTO phases (id,regimen_id,dosage,dose_morning,dose_lunch,dose_dinner,dose_custom,custom_time,duration_days,days_of_week,indefinite,sequence_order) VALUES (?,?,0,?,?,?,?,?,?,?,?,?)',
          [uuid(), phaseRegimenId, morning, lunch, dinner, custom, ct, dur, daysJson, phaseIndefinite ? 1 : 0, nextOrder],
        );
      }
      setPhaseModal(false);
      setCalcResults({});
      await reloadOpenSession();
    } catch (e: unknown) {
      Alert.alert('Error', String(e));
    }
  }
  ```

- [ ] **Step 4: Replace the dosage input JSX in the phase modal**

  In the phase modal JSX, find the single dosage input row (around lines 1331–1341). It looks like:
  ```tsx
  {/* Dosage */}
  <View className="...">
    <Text ...>Dosage</Text>
    <View className="flex-row ...">
      <TextInput
        value={phaseDosage}
        onChangeText={setPhaseDosage}
        ...
      />
      <Text ...>{phaseUnit}</Text>
    </View>
  </View>
  ```

  Replace that entire block with:

  ```tsx
  {/* Time-of-day doses */}
  {(['morning', 'lunch', 'dinner', 'custom'] as const).map((slot) => {
    const val   = slot === 'morning' ? phaseMorning : slot === 'lunch' ? phaseLunch : slot === 'dinner' ? phaseDinner : phaseCustom;
    const setVal = slot === 'morning' ? setPhaseMorning : slot === 'lunch' ? setPhaseLunch : slot === 'dinner' ? setPhaseDinner : setPhaseCustom;
    const label  = slot.charAt(0).toUpperCase() + slot.slice(1);
    return (
      <View key={slot} className="flex-row items-center justify-between py-2 border-b border-gray-700/50">
        <Text className="text-gray-300 text-sm w-20">{label}</Text>
        <TextInput
          value={val}
          onChangeText={setVal}
          keyboardType="decimal-pad"
          className="bg-gray-800 text-white text-sm rounded px-3 py-1.5 w-20 text-right"
        />
        <Text className="text-gray-500 text-sm ml-2 w-20">{phaseUnit}</Text>
      </View>
    );
  })}
  {/* Custom time picker row — only visible when custom dose > 0 */}
  {parseFloat(phaseCustom) > 0 && (
    <Pressable
      onPress={() => setShowPhaseCustomPicker(true)}
      className="flex-row items-center justify-between py-2 border-b border-gray-700/50"
    >
      <Text className="text-gray-500 text-xs ml-24">Custom time</Text>
      <Text className="text-violet-400 text-sm font-mono mr-4">{phaseCustomTime}</Text>
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

- [ ] **Step 5: Verify TypeScript compiles**

  ```bash
  cd app && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: errors only in `phaseLabel` and phase row rendering (fixed in Task 4).

- [ ] **Step 6: Commit**

  ```bash
  git add app/src/screens/RegimensScreen.tsx
  git commit -m "feat(app): phase editor supports Morning/Lunch/Dinner/Custom dose fields"
  ```

---

## Task 4: Phase Label + Active Phase Countdown

**Files:**
- Modify: `app/src/screens/RegimensScreen.tsx`

- [ ] **Step 1: Update `phaseLabel` function**

  Find `phaseLabel` (lines 44–52):
  ```ts
  function phaseLabel(p: Phase, unit: string): string {
    const isIndef = p.indefinite === 1;
    const dur = isIndef ? '∞' : phaseDurLabel(p.duration_days);
    const dow = p.days_of_week ? JSON.parse(p.days_of_week) as number[] : null;
    const dowStr = dow && dow.length > 0 && dow.length < 7
      ? ' · ' + dow.map((d) => DOW_LABELS[d]).join(' ')
      : '';
    return `${fmtAmount(Number(p.dosage), unit)}/dose · ${dur}${dowStr}`;
  }
  ```

  Replace with:
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

- [ ] **Step 2: Add `getPhaseStatus` helper**

  Add this pure helper function just below `phaseLabel` (after line 52, before the component function):

  ```ts
  type PhaseStatus = { status: 'completed' | 'active' | 'upcoming'; daysLeft: number | null };

  function getPhaseStatus(phase: Phase, allPhases: Phase[], sessionStartDate: string): PhaseStatus {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(sessionStartDate);
    start.setHours(0, 0, 0, 0);

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

- [ ] **Step 3: Update phase row rendering**

  Find the phase row `.map()` callback in the regimen card (lines 940–956):
  ```tsx
  regimenPhases.map((p, idx) => (
    <View key={p.id} className="flex-row items-center gap-2 mb-1.5">
      <Pressable
        onPress={() => openPhaseModal(r.id, unit, p)}
        className="flex-row items-center gap-2 flex-1"
      >
        <View className="w-5 h-5 rounded-full bg-violet-900/60 border border-violet-700/50 items-center justify-center">
          <Text className="text-violet-400 text-xs font-bold">{idx + 1}</Text>
        </View>
        <Text className="text-gray-300 text-xs flex-1">{phaseLabel(p, unit)}</Text>
        <Text className="text-gray-600 text-xs">✎</Text>
      </Pressable>
      <Pressable onPress={() => deletePhase(p.id)} hitSlop={8}>
        <Text className="text-red-700 text-xs px-1">✕</Text>
      </Pressable>
    </View>
  ))
  ```

  Replace with:
  ```tsx
  regimenPhases.map((p, idx) => {
    const { status, daysLeft } = openSess
      ? getPhaseStatus(p, regimenPhases, openSess.start_date)
      : { status: 'upcoming' as const, daysLeft: null };
    return (
      <View key={p.id} className="flex-row items-center gap-2 mb-1.5">
        <Pressable
          onPress={() => openPhaseModal(r.id, unit, p)}
          className="flex-row items-center gap-2 flex-1"
        >
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
  })
  ```

- [ ] **Step 4: Verify TypeScript compiles clean**

  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 5: Commit**

  ```bash
  git add app/src/screens/RegimensScreen.tsx
  git commit -m "feat(app): phase label shows time-of-day doses; active phase shows days-left badge"
  ```

---

## Task 5: Template Snapshot Update

**Files:**
- Modify: `app/src/screens/RegimensScreen.tsx`

- [ ] **Step 1: Update `saveAsTemplate` phase SELECT query**

  Find `saveAsTemplate` (lines ~139–168). Find this line inside the `regs.map()`:
  ```ts
  'SELECT dosage, duration_days, days_of_week, indefinite, sequence_order FROM phases WHERE regimen_id = ? ORDER BY sequence_order',
  ```

  Replace with:
  ```ts
  'SELECT dosage, dose_morning, dose_lunch, dose_dinner, dose_custom, custom_time, duration_days, days_of_week, indefinite, sequence_order FROM phases WHERE regimen_id = ? ORDER BY sequence_order',
  ```

- [ ] **Step 2: Update `applyTemplate` phase INSERT**

  Find `applyTemplate` (lines ~170–197). Find this INSERT:
  ```ts
  await db.runAsync(
    'INSERT INTO phases (id, regimen_id, dosage, duration_days, days_of_week, indefinite, sequence_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuid(), newRegimenId, p.dosage, p.duration_days, p.days_of_week, p.indefinite, p.sequence_order],
  );
  ```

  Replace with:
  ```ts
  await db.runAsync(
    'INSERT INTO phases (id, regimen_id, dosage, dose_morning, dose_lunch, dose_dinner, dose_custom, custom_time, duration_days, days_of_week, indefinite, sequence_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [uuid(), newRegimenId, p.dosage, p.dose_morning, p.dose_lunch, p.dose_dinner, p.dose_custom, p.custom_time, p.duration_days, p.days_of_week, p.indefinite, p.sequence_order],
  );
  ```

- [ ] **Step 3: Verify TypeScript compiles clean**

  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 4: Commit**

  ```bash
  git add app/src/screens/RegimensScreen.tsx
  git commit -m "feat(app): template snapshot includes time-of-day dose fields"
  ```

---

## Task 6: Build and Verify on Device

- [ ] **Step 1: Full TypeScript check**

  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 2: Build and install**

  ```bash
  cd app && JAVA_HOME="/c/Program Files/Android/Android Studio1/jbr" \
    ANDROID_HOME="/c/Users/Andrew/AppData/Local/Android/Sdk" \
    npx expo run:android
  ```

- [ ] **Step 3: Manual verification checklist**

  - [ ] Tap "Add Phase" on a regimen card — modal shows Morning / Lunch / Dinner / Custom rows instead of single Dosage field
  - [ ] Enter a value in Custom → "Custom time" row appears with a time picker
  - [ ] Save phase — phase label shows e.g. `1 cap morning · 14d`
  - [ ] Open a session with a start date in the past — active phase shows violet `Xd` badge; completed phases are struck through
  - [ ] Indefinite active phase shows `∞` badge
  - [ ] Upcoming phases appear dimmed
  - [ ] Existing phases (migrated from old `dosage`) show their dose under Morning
  - [ ] Calculate still works — shortfall/bottles/cost numbers are correct
  - [ ] Save + apply a session template — phases restore with all four dose fields intact
