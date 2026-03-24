# PillPipe: FileSystem Export Fix — Design Spec
**Date:** 2026-03-24
**Status:** Approved

---

## Overview

Migrate all `expo-file-system` legacy API calls in the Android app to the modern `expo-file-system/next` API. Three operations are affected: CSV export, JSON backup export, and JSON backup restore. No permission dialogs are needed — the share-sheet approach (write to cache → `expo-sharing`) handles all export scenarios without requiring storage permissions.

---

## Background

`FileSystem.writeAsStringAsync` and `FileSystem.readAsStringAsync` from `expo-file-system` are deprecated in Expo SDK 54. The JSON backup export throws a deprecation warning; the CSV export fails entirely. The modern replacement is the `File` and `Directory` class API from `expo-file-system/next`, combined with `Paths` for standard directory references.

---

## Section 1 — API Migration Map

| Legacy call | Modern replacement |
|---|---|
| `import * as FileSystem from 'expo-file-system'` | `import { File, Paths } from 'expo-file-system/next'` |
| `FileSystem.writeAsStringAsync(path, content)` | `await new File(path).write(content)` |
| `FileSystem.readAsStringAsync(uri)` | `await new File(uri).text()` |
| `FileSystem.cacheDirectory + 'filename'` | `Paths.cache + '/filename'` |

No other file system APIs (`copyAsync`, `deleteAsync`, `getInfoAsync`, etc.) are used in the affected files — only read and write.

---

## Section 2 — CSV Export

**File:** `app/src/screens/RegimensScreen.tsx`
**Function:** `exportCSV()`

### Current flow (broken)
```ts
const path = FileSystem.cacheDirectory + 'pillpipe-export.csv';
await FileSystem.writeAsStringAsync(path, csvString);
await Sharing.shareAsync(path);
```

### New flow
```ts
import { File, Paths } from 'expo-file-system/next';

const file = new File(Paths.cache + '/pillpipe-export.csv');
await file.write(csvString);
await Sharing.shareAsync(file.uri);
```

Error handling: existing try/catch block retained; `Alert.alert('Export Failed', String(e))` on failure.

---

## Section 3 — JSON Backup Export

**File:** `app/src/screens/SettingsScreen.tsx`
**Function:** `exportBackup()`

### Current flow (deprecated warning)
```ts
const path = FileSystem.cacheDirectory + 'pillpipe-backup.json';
await FileSystem.writeAsStringAsync(path, jsonString);
await Sharing.shareAsync(path);
```

### New flow
```ts
import { File, Paths } from 'expo-file-system/next';

const file = new File(Paths.cache + '/pillpipe-backup.json');
await file.write(jsonString);
await Sharing.shareAsync(file.uri);
```

Error handling: existing try/catch retained; `Alert.alert('Backup Failed', String(e))` on failure.

---

## Section 4 — JSON Backup Restore

**File:** `app/src/screens/SettingsScreen.tsx`
**Function:** `importBackup()`

The document picker call (`expo-document-picker`) is unchanged — it returns a URI for the user-selected file. Only the read call changes.

### Current flow
```ts
const content = await FileSystem.readAsStringAsync(pickedUri);
```

### New flow
```ts
import { File } from 'expo-file-system/next';

const content = await new File(pickedUri).text();
```

Error handling: existing try/catch retained; `Alert.alert('Restore Failed', String(e))` on failure.

---

## Section 5 — Permission Handling

No storage permission changes are needed. The share-sheet approach (`expo-sharing`) writes to the app's internal cache directory (`Paths.cache`) which requires no `WRITE_EXTERNAL_STORAGE` permission, then hands off to the OS share sheet for the user to route the file to Downloads, Google Drive, email, etc.

---

## File Changelist

| File | Change |
|---|---|
| `app/src/screens/RegimensScreen.tsx` | Update `exportCSV()`: replace legacy FileSystem write with `File.write()` |
| `app/src/screens/SettingsScreen.tsx` | Update `exportBackup()` and `importBackup()`: replace legacy FileSystem calls |

---

## Out of Scope

- Web app export (uses browser Blob API — not affected)
- PDF export (web-only, not affected)
- Storage permission dialogs
- Any other `expo-file-system` usage outside the three listed functions
