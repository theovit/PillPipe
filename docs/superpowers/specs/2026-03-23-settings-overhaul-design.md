# Design: Settings Overhaul (Group B)

**Date:** 2026-03-23
**Scope:** `app/` only
**Status:** Approved

---

## Context

The Android app's Settings screen is a flat list of always-visible cards. The web app has collapsible sections, a default session duration preference, and a font size selector. This group brings the app to parity on those three features.

---

## Changes

### 1. AppPrefs extension

Add two fields to `AppPrefs` in `app/src/utils/prefs.ts`:

```ts
export interface AppPrefs {
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  accentColor: AccentColor;
  fontSize: 'small' | 'medium' | 'large';         // NEW — default 'medium'
  defaultDuration: 0 | 30 | 60 | 90 | 120;        // NEW — default 0
}

const DEFAULT: AppPrefs = {
  dateFormat: 'MM/DD/YYYY',
  accentColor: 'violet',
  fontSize: 'medium',
  defaultDuration: 0,
};
```

`initPrefs()` spreads over `DEFAULT` (`{ ...DEFAULT, ...JSON.parse(raw) }`), so existing installs forward-fill the new keys automatically — no migration needed.

---

### 2. Collapsible Settings sections

`SettingsScreen.tsx` gets a `openSections` state:

```ts
const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
function toggleSection(name: string) {
  setOpenSections(p => ({ ...p, [name]: !p[name] }));
}
```

All sections start collapsed (same as web). Each section card renders a tappable header row with a ▲/▼ chevron that calls `toggleSection`. Content renders only when the section is open.

**Section map:**

| Section key | Header label | Content |
|---|---|---|
| `about` | About | App name, version, tagline |
| `appearance` | Appearance | Accent color picker |
| `preferences` | Preferences | Date format + Default duration + Font size |
| `templates` | Templates | Template list with delete (hidden when empty) |
| `notifications` | Notifications | Permission status + enable button |
| `backup` | Backup & Restore | Export / Import buttons |
| `data` | Data | Clear all data button |

Date format moves from its own top-level card into the Preferences section alongside the two new controls.

---

### 3. Default session duration

**In SettingsScreen — Preferences section:**

Selector with options: **None · 30 days · 60 days · 90 days · 120 days**

Same pill-button style as date format. Calls `savePrefs({ defaultDuration: value })`.

**In RegimensScreen — New Session modal:**

When the modal opens, if `prefs.defaultDuration > 0`, pre-fill `sessionTarget` to today + `defaultDuration` days. If `defaultDuration === 0`, `sessionTarget` stays blank (current behaviour).

Logic (placed where `setSessionModal(true)` is called):

```ts
const prefs = loadPrefs();
if (prefs.defaultDuration > 0) {
  const d = new Date();
  d.setDate(d.getDate() + prefs.defaultDuration);
  setSessionTarget(d.toISOString().slice(0, 10));
} else {
  setSessionTarget('');
}
```

---

### 4. Font size

**In SettingsScreen — Preferences section:**

Selector with options: **Small · Medium · Large**

Same pill-button style. Calls `savePrefs({ fontSize: value })`. Label below: "Applies to all text in the app."

**In App.tsx — startup:**

After `initPrefs()` resolves (already gated by `prefsReady`), read `loadPrefs().fontSize` and call NativeWind's rem override before any screen renders:

```ts
import { rem } from 'nativewind';

const fontScaleMap = { small: 12, medium: 14, large: 16 } as const;

// Inside the initPrefs useEffect, after await initPrefs():
rem.setInput(fontScaleMap[loadPrefs().fontSize]);
setPrefsReady(true);
```

| Setting | Rem base | `text-base` result |
|---|---|---|
| Small | 12px | ~10.5px |
| Medium | 14px | ~14px (unchanged default) |
| Large | 16px | ~16px |

Because `rem.setInput` is called before `setPrefsReady(true)`, the font scale is applied before any screen renders — no flash of wrong size.

---

## Files Changed

| File | Change |
|---|---|
| `app/src/utils/prefs.ts` | Add `fontSize` and `defaultDuration` to `AppPrefs` and `DEFAULT` |
| `app/src/screens/SettingsScreen.tsx` | Collapsible sections; Preferences section with date format + duration + font size |
| `app/src/screens/RegimensScreen.tsx` | Pre-fill target date in New Session modal using `defaultDuration` |
| `app/App.tsx` | Call `rem.setInput()` after `initPrefs()` resolves |

---

## Out of Scope

- Color scheme / light-dark mode (Group C — Theming)
- Custom accent color hex input (Group C)
- Backup infrastructure overhaul (Group D)
- iOS-specific behaviour
