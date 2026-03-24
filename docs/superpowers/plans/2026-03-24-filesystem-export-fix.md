# FileSystem Export Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all deprecated `expo-file-system` legacy API calls with the modern `expo-file-system/next` API so that CSV export, JSON backup export, and JSON backup restore all work correctly on Android.

**Architecture:** Two files are affected — `RegimensScreen.tsx` (CSV export) and `SettingsScreen.tsx` (JSON backup export + restore). Each file removes two legacy imports and swaps `FileSystem.writeAsStringAsync` / `FileSystem.readAsStringAsync` for `new File(Paths.cache, name).write()` / `new File(uri).text()`. No permission changes, no UI changes.

**Tech Stack:** Expo SDK 54, `expo-file-system/next` (File, Paths), `expo-sharing`

**Spec:** `docs/superpowers/specs/2026-03-24-filesystem-export-fix-design.md`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `app/src/screens/RegimensScreen.tsx` | Modify | Remove legacy FileSystem imports; update `exportCSV()` |
| `app/src/screens/SettingsScreen.tsx` | Modify | Remove legacy FileSystem imports; update `exportBackup()` and `importBackup()` |

---

## Task 1: Fix CSV Export in RegimensScreen

**Files:**
- Modify: `app/src/screens/RegimensScreen.tsx` (lines 21–22, 440–444)

- [ ] **Step 1: Replace legacy imports**

  Open `app/src/screens/RegimensScreen.tsx`. Find lines 21–22:
  ```ts
  import * as FileSystem from 'expo-file-system';
  import { cacheDirectory } from 'expo-file-system/legacy';
  ```

  Replace both lines with a single line:
  ```ts
  import { File, Paths } from 'expo-file-system/next';
  ```

- [ ] **Step 2: Update the write/share block inside `exportCSV()`**

  Find the `try` block inside `exportCSV()` (currently lines ~440–444):
  ```ts
  try {
    const path = `${cacheDirectory}pillpipe-${session.target_date}.csv`;
    await FileSystem.writeAsStringAsync(path, csv);
    await Sharing.shareAsync(path, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  } catch { Alert.alert('Error', 'Could not export CSV'); }
  ```

  Replace it with:
  ```ts
  try {
    const file = new File(Paths.cache, `pillpipe-${session.target_date}.csv`);
    await file.write(csv);
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
  } catch { Alert.alert('Error', 'Could not export CSV'); }
  ```

  Key changes: `cacheDirectory` path → `new File(Paths.cache, filename)`; `writeAsStringAsync` → `file.write()`; string path → `file.uri`.

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd app && npx tsc --noEmit 2>&1 | head -20
  ```
  Expected: no new errors referencing `RegimensScreen.tsx`.

- [ ] **Step 4: Commit**

  ```bash
  git add app/src/screens/RegimensScreen.tsx
  git commit -m "fix(app): migrate CSV export to expo-file-system/next"
  ```

---

## Task 2: Fix Backup Export and Restore in SettingsScreen

**Files:**
- Modify: `app/src/screens/SettingsScreen.tsx` (lines 6–7, ~148–150, ~163)

- [ ] **Step 1: Replace legacy imports**

  Open `app/src/screens/SettingsScreen.tsx`. Find lines 6–7:
  ```ts
  import * as FileSystem from 'expo-file-system';
  import { cacheDirectory } from 'expo-file-system/legacy';
  ```

  Replace both with:
  ```ts
  import { File, Paths } from 'expo-file-system/next';
  ```

- [ ] **Step 2: Update the write/share block inside `exportBackup()`**

  Find these three lines inside `exportBackup()` (currently ~lines 148–150):
  ```ts
  const path = `${cacheDirectory}pillpipe-backup-${date}.json`;
  await FileSystem.writeAsStringAsync(path, json);
  await Sharing.shareAsync(path, { mimeType: 'application/json', UTI: 'public.json' });
  ```

  Replace with:
  ```ts
  const file = new File(Paths.cache, `pillpipe-backup-${date}.json`);
  await file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
  ```

- [ ] **Step 3: Update the read call inside `importBackup()`**

  Find this line inside `importBackup()` (currently ~line 163):
  ```ts
  const json = await FileSystem.readAsStringAsync(result.assets[0].uri);
  ```

  Replace with:
  ```ts
  const json = await new File(result.assets[0].uri).text();
  ```

  The document picker already uses `copyToCacheDirectory: true` (a few lines above), which guarantees the returned URI is a `file://` path — safe for `new File(uri)`.

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd app && npx tsc --noEmit 2>&1 | head -20
  ```
  Expected: no new errors referencing `SettingsScreen.tsx`.

- [ ] **Step 5: Commit**

  ```bash
  git add app/src/screens/SettingsScreen.tsx
  git commit -m "fix(app): migrate JSON backup export and restore to expo-file-system/next"
  ```

---

## Task 3: Build and verify on device

- [ ] **Step 1: Full TypeScript check**

  ```bash
  cd app && npx tsc --noEmit
  ```
  Expected: zero new errors (pre-existing errors unrelated to this sprint are OK).

- [ ] **Step 2: Build and install**

  ```bash
  cd app && JAVA_HOME="/c/Program Files/Android/Android Studio1/jbr" \
    ANDROID_HOME="/c/Users/Andrew/AppData/Local/Android/Sdk" \
    npx expo run:android
  ```

- [ ] **Step 3: Manual verification checklist**

  - [ ] Navigate to Regimens tab → open a session → tap **Export CSV** → share sheet appears, file saves to Downloads or Drive
  - [ ] Navigate to Settings → tap **Export Backup** → share sheet appears with a `.json` file
  - [ ] Navigate to Settings → tap **Import Backup** → pick the `.json` file just exported → confirm restore → data appears correctly
  - [ ] No "deprecated" warnings in Metro logs for `writeAsStringAsync`
  - [ ] No crash on any of the three operations
