# PillPipe: FileSystem Export Fix — Design Spec
**Date:** 2026-03-24
**Status:** Approved

---

## Overview

Migrate all `expo-file-system` legacy API calls in the Android app to the modern `expo-file-system/next` API. Three operations are affected: CSV export, JSON backup export, and JSON backup restore. No permission dialogs are needed — the share-sheet approach (write to cache → `expo-sharing`) handles all export scenarios without requiring storage permissions.

---

## Background

`FileSystem.writeAsStringAsync` and `FileSystem.readAsStringAsync` from `expo-file-system` are deprecated in Expo SDK 54. The JSON backup export throws a deprecation warning; the CSV export fails entirely. The modern replacement is the `File` class API from `expo-file-system/next`, combined with `Paths` for standard directory references.

---

## Section 1 — API Migration Map

| Legacy call | Modern replacement |
|---|---|
| `import * as FileSystem from 'expo-file-system'` | `import { File, Paths } from 'expo-file-system/next'` |
| `import { cacheDirectory } from 'expo-file-system/legacy'` | removed (use `Paths.cache` instead) |
| `FileSystem.writeAsStringAsync(path, content)` | `await new File(Paths.cache, 'filename').write(content)` |
| `FileSystem.readAsStringAsync(uri)` | `await new File(uri).text()` |
| `` `${cacheDirectory}filename` `` | `new File(Paths.cache, 'filename')` — note: `Paths.cache` is a `Directory` object, NOT a string; use the two-argument `File` constructor |

**Import cleanup:** Both `RegimensScreen.tsx` and `SettingsScreen.tsx` currently have two legacy imports that must both be removed:
- `import * as FileSystem from 'expo-file-system'`
- `import { cacheDirectory } from 'expo-file-system/legacy'`

Replace with: `import { File, Paths } from 'expo-file-system/next'`

---

## Section 2 — CSV Export

**File:** `app/src/screens/RegimensScreen.tsx`
**Function:** `exportCSV()`

### Current flow (broken)
```ts
const path = `${cacheDirectory}pillpipe-${session.target_date}.csv`;
await FileSystem.writeAsStringAsync(path, csvString);
await Sharing.shareAsync(path);
```

### New flow
```ts
import { File, Paths } from 'expo-file-system/next';

const file = new File(Paths.cache, `pillpipe-${session.target_date}.csv`);
await file.write(csvString);
await Sharing.shareAsync(file.uri);
```

The dynamic filename using `session.target_date` is preserved. Error handling: existing try/catch block retained; `Alert.alert('Export Failed', String(e))` on failure.

---

## Section 3 — JSON Backup Export

**File:** `app/src/screens/SettingsScreen.tsx`
**Function:** `exportBackup()`

### Current flow (deprecated warning)
```ts
const path = `${cacheDirectory}pillpipe-backup-${date}.json`;
await FileSystem.writeAsStringAsync(path, json);
await Sharing.shareAsync(path, { mimeType: 'application/json', UTI: 'public.json' });
```

### New flow
```ts
import { File, Paths } from 'expo-file-system/next';

const file = new File(Paths.cache, `pillpipe-backup-${date}.json`);
await file.write(json);
await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
```

The dynamic filename and `shareAsync` options (`mimeType`, `UTI`) are preserved. Error handling: existing try/catch retained; `Alert.alert('Backup Failed', String(e))` on failure.

---

## Section 4 — JSON Backup Restore

**File:** `app/src/screens/SettingsScreen.tsx`
**Function:** `importBackup()`

The document picker call (`expo-document-picker`) is unchanged. The picker is called with `copyToCacheDirectory: true`, which ensures the returned URI is always a `file://` URI (Android copies the `content://` provider file to a cache path). This makes `new File(uri)` safe.

### Current flow
```ts
const content = await FileSystem.readAsStringAsync(pickedUri);
```

### New flow
```ts
import { File } from 'expo-file-system/next';

const content = await new File(pickedUri).text();
```

The `copyToCacheDirectory: true` option on the picker call must remain in place. Error handling: existing try/catch retained; `Alert.alert('Restore Failed', String(e))` on failure.

---

## Section 5 — Permission Handling

No storage permission changes are needed. The share-sheet approach (`expo-sharing`) writes to the app's internal cache directory (`Paths.cache`) which requires no `WRITE_EXTERNAL_STORAGE` permission, then hands off to the OS share sheet for the user to route the file to Downloads, Google Drive, email, etc.

`Sharing.isAvailableAsync()` check: out of scope for this sprint. On Android the share sheet is always available; the existing error handling (try/catch → Alert) is sufficient.

---

## File Changelist

| File | Change |
|---|---|
| `app/src/screens/RegimensScreen.tsx` | `exportCSV()`: remove both legacy FileSystem imports; replace write path with `new File(Paths.cache, filename).write()`; update `shareAsync` call |
| `app/src/screens/SettingsScreen.tsx` | `exportBackup()` and `importBackup()`: remove both legacy FileSystem imports; replace write/read with modern `File` API |

---

## Out of Scope

- Web app export (uses browser Blob API — not affected)
- PDF export (web-only, not affected)
- Storage permission dialogs
- `Sharing.isAvailableAsync()` guard
- Any other `expo-file-system` usage outside the three listed functions
