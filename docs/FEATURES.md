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
- [stable] Phase editor — add, edit and delete phases per regimen (phases run in the order added; there is no reorder control)

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
- [stable] Dose reminders — Web Push (VAPID), subscribe/unsubscribe in Settings, test notification; reminders now follow each phase's dose times (see Dosing Schedules); Taken/Skip on a notification is logged by the service worker

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
- [beta] Meal-time dosing (web + Android) — Breakfast / Lunch / Dinner amounts plus up to 12 custom-time doses per phase; amounts may be fractional for every unit; they sum to drive the shortfall calculator, days-remaining and low-stock alerts. (Web UI says Breakfast/Lunch/Dinner; Android says Morning/Lunch/Dinner.)
- [beta] Meal time settings (web + Android) — default times in Settings. The web app also stores your timezone (auto-detected, editable) so "today" and reminder times are yours rather than the server's UTC.
- [beta] Batched dose reminders (web) — one push per time listing everything due then (amount, "with food"); only regimens active that day (right phase, a dosing day, not As Needed). Taken/Skip on the notification is logged by the service worker, for regimens with a single dose that day. **Not yet verified on a real device** — see `docs/TODO.md`.
- [beta] Compact schedule notation (web) — `B1 L1 D2 +1@2:30 PM · 5 caps/day` for the phase active today; CSV/PDF exports gain a Schedule column.
- [beta] Take with food (web) — flag on a supplement; badge on the supplement and its regimen card, and "(with food)" in reminders.
- [beta] As Needed (web) — regimen flag: label only, with no phases, reminders, logging or shortfall/supply math.
- [WIP] Android: per-regimen local reminders exist, but Android has no Take with food / As Needed flags and its reminders are not derived from phase slots.

## Android App
*Overall status: alpha — features are implemented but not verified on-device this cycle. Several bug-fix passes landed 2026-03-23/24. See `app/TODO.md` for granular parity status. Known gap: session templates and regimen notifications are not included in backup/restore.*

- [WIP] App scaffold — React Native / Expo, local SQLite, offline-first, no server required
- [WIP] Session & regimen management — edit session, copy session, regimen notes, native date pickers
- [WIP] Phase editor — add, edit, delete phases; indefinite support; days-of-week selector
- [WIP] Dose logging — taken/skip buttons, mark-all bulk action, adherence calendar
- [WIP] Shortfall calculator — on-device engine; shortfall alert card; CSV export; shopping list share
- [WIP] Push notifications — local scheduled via expo-notifications; reminder time picker per regimen
- [beta] Session templates — save, apply on new session, manage in Settings
- [WIP] Settings — date format, font size, default session duration, reminder times, version display, notification permission (collapsible sections)
- [WIP] Backup / restore — JSON export and import via device file system
