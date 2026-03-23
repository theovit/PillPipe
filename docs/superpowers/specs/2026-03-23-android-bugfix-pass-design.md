# Design: Android App — Bug Fix Pass (Group A)

**Date:** 2026-03-23
**Scope:** `app/` only — no changes to `client/`, `server/`, or `db/`
**Status:** Approved

---

## Context

Four bugs identified in the Android app after the parity pass. Bugs 1 and 2 share the same root cause (missing safe area provider). No new packages or DB changes required.

---

## Bug 1 & 2 — Safe area / header pushed under status bar (unclickable Cancel)

**Root cause:** `NavigationContainer` in `App.tsx` is not wrapped in `SafeAreaProvider`. React Navigation cannot compute insets, so the navigation header renders at `y=0`, behind the Android status bar (~24–28dp). Any buttons in the header (e.g. Cancel) are physically obscured by the notification bar and cannot be tapped.

**Fix:** Import `SafeAreaProvider` from `react-native-safe-area-context` (already a transitive Expo dependency — no new package install needed) and wrap `NavigationContainer` with it in `App.tsx`:

```tsx
import { SafeAreaProvider } from 'react-native-safe-area-context';

// In JSX:
<SafeAreaProvider>
  <NavigationContainer>
    ...
  </NavigationContainer>
</SafeAreaProvider>
```

React Navigation detects the provider automatically and applies the correct top inset to all screen headers, making the header and its buttons fully visible and tappable.

**Files affected:** `app/App.tsx`

**Validation:** Launch the app on a physical Android device. Confirm the header is fully visible below the status bar. Confirm Cancel / header action buttons are tappable in all three tabs.

---

## Bug 3 — Hardware back button does not dismiss modals

**Root cause:** Modal components in `RegimensScreen.tsx` and `SettingsScreen.tsx` do not set `onRequestClose`. On Android, pressing the hardware back button while a modal is open fires `onRequestClose`; without it, the modal ignores the back press.

**Fix:** Add `onRequestClose` to every `<Modal>` in both screens. The handler should call the same function that the Cancel / close button calls.

Example pattern:
```tsx
<Modal
  visible={someVisible}
  onRequestClose={() => setSomeVisible(false)}
  ...
>
```

For modals that have more complex cancel logic (e.g. resetting form state), `onRequestClose` should call the full cancel handler, not just hide the modal.

**Files affected:** `app/src/screens/RegimensScreen.tsx`, `app/src/screens/SettingsScreen.tsx`

**Validation:** Open each modal. Press the hardware back button. The modal must dismiss and all related state must reset (same result as tapping Cancel).

---

## Bug 4 — Date format preference not applied to New Regimen start date

**Root cause:** The start date field in the new regimen flow displays the raw ISO string (`YYYY-MM-DD`) rather than formatting it through the user's `dateFormat` preference using the existing `formatDate` helper.

**Fix:** Ensure `prefs` is loaded in `RegimensScreen.tsx` (it is already used elsewhere in the file). Wherever the selected start date is rendered as a text label in the new regimen modal, wrap it in `formatDate(startDate, prefs.dateFormat)` instead of displaying the raw value.

`formatDate` signature (already exists in `app/src/utils/dates.ts`):
```ts
formatDate(isoString: string, format: AppPrefs['dateFormat']): string
```

**Files affected:** `app/src/screens/RegimensScreen.tsx`

**Validation:** Set date format to DD/MM/YYYY in Settings. Open the new regimen modal. Confirm the start date label shows in the selected format.

---

## Files Changed

| File | Change |
|---|---|
| `app/App.tsx` | Wrap `NavigationContainer` in `SafeAreaProvider` |
| `app/src/screens/RegimensScreen.tsx` | Add `onRequestClose` to all modals; apply `formatDate` to start date display |
| `app/src/screens/SettingsScreen.tsx` | Add `onRequestClose` to all modals |

---

## Out of Scope

- Light/dark theming (Group C)
- Settings refactor (Group B)
- Backup infrastructure (Group D)
- iOS-specific safe area handling
