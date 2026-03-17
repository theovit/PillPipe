# Features

## Session Management
- [stable] Multiple active sessions — open any number of sessions simultaneously, each in its own pane
- [stable] Copy session — clone all regimens and phases to a new session
- [stable] Session date validation — target date must be after start date
- [stable] Session templates — save any session as a named template; apply on new session creation; manage in Settings
- [stable] Block calculate when a regimen has no phases

## Regimen & Phase Management
- [stable] Days-of-week dosing — schedule regimens on specific days only
- [stable] Indefinite phase support — phases with no fixed end date fill the rest of the session
- [stable] Per-regimen notes with auto-save
- [stable] Collapse/expand regimen cards and sessions sidebar
- [stable] Phase editor — add, edit, reorder, and delete phases per regimen

## Supplement Inventory
- [stable] Quick inventory adjustment — +/− buttons on supplement rows
- [stable] Running low alerts — per-supplement reorder threshold; ⚠ badge on row; daily 8am push notification with on-hand count and days remaining
- [stable] Liquid & drops support — unit field (capsules/tablets/ml/drops), drops_per_ml override, decimal dosage/inventory, ml↔drops conversion in calculator

## Shortfall Calculator
- [stable] Shortfall engine — calculates pills consumed, real-time on-hand, shortfall, bottles to buy, waste, cost, and days of coverage per regimen
- [stable] Grand total cost across all regimens
- [stable] CSV export — session header + per-regimen results + grand total; appears after Calculate runs
- [stable] PDF export — jsPDF + jspdf-autotable; session header, results table, grand total footer; client-side only
- [stable] Shopping list — post-calculate modal listing all shortfall items, grand total, one-click copy to clipboard

## Dose Logging & Adherence
- [stable] Dose logging — "Taken today / Skip today" buttons per regimen; change/undo support
- [stable] Adherence calendar — 30-day dot grid per regimen (green=taken, red=skipped, gray=missed) with adherence % stat
- [stable] Bulk actions — "Mark all taken / Skip all" bar
- [stable] Dose reminders — Web Push (VAPID), per-regimen reminder time picker, subscribe/unsubscribe in Settings, server-side cron checks every minute; doses tapped from notifications are logged via service worker

## Data & Backup
- [stable] Manual backup / restore / clear — full DB + client prefs exported as JSON
- [stable] Google Drive backup — OAuth2 connect; manual, daily, or on-change modes; timestamped uploads; restore any previous backup from Settings
- [stable] Backup includes appearance and preference settings

## Settings & UI
- [stable] Dark / Light / System mode — follows system preference in auto mode; CSS variable swap
- [stable] Appearance settings — theme color (6 presets + custom HSL), font size (small/medium/large); persisted and server-synced
- [stable] Preferences settings — date format, default session duration; persisted and server-synced
- [stable] Mobile touch-friendly UI — tap to edit, hidden icons, responsive action buttons
- [stable] Delete confirmations — sessions, regimens, supplements
- [stable] About section — version, description, GitHub link, MIT license
- [stable] Version display — read from package.json via GET /version; shown in Settings footer
- [WIP] Donate / Support section — code complete, hidden behind `false &&` guard in Dashboard.jsx; activate once Ko-fi / GitHub Sponsors pages are live

## Dosing Schedules
- [WIP] Meal-time dosing — per-meal slot system replacing flat daily dose; B/L/D predefined + custom time slots; slot amounts sum to drive all inventory math
- [WIP] Global meal time settings — Breakfast/Lunch/Dinner time pickers in Settings; server-synced and included in backups
- [WIP] Batched push notifications — one notification per time slot grouping all pills due at that time; removes per-regimen reminder_time picker
- [WIP] "Take with food" flag — boolean on supplement record; surfaces on regimen card and in push notification text
- [WIP] Compact slot notation on regimen cards — B1 L1 D2 style display with total daily dose as secondary stat

## Android App
*Overall status: alpha — features are scaffolded but many are not yet reliably working. See `app/TODO.md` for granular parity status.*

- [WIP] App scaffold — React Native / Expo, local SQLite, offline-first, no server required
- [WIP] Session & regimen management — edit session, copy session, regimen notes, native date pickers
- [WIP] Phase editor — add, edit, delete phases; indefinite support; days-of-week selector
- [WIP] Dose logging — taken/skip buttons, mark-all bulk action, adherence calendar
- [WIP] Shortfall calculator — on-device engine; shortfall alert card; CSV export; shopping list share
- [WIP] Push notifications — local scheduled via expo-notifications; reminder time picker per regimen
- [WIP] Settings — date format preference, version display, notification permission
- [WIP] Backup / restore — JSON export and import via device file system
