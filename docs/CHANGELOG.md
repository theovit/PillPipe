# Changelog

## [Unreleased]
### Added
### Changed
### Fixed
### Removed

## [2.0.0-app] — 2025-03-17
### Added
- Android / Expo app: parity pass — supplements fields, phase coverage, backup/restore
- Android / Expo app: cross-platform DateField; native date picker on mobile, text input on web
- Android / Expo app: edit session, inventory ±, reminders, CSV export, settings overhaul
- Android / Expo app: adherence calendar, native date pickers
- Android / Expo app: dev seed refactor
- Android / Expo app: dose logging, regimen notes, shopping list share
- Android / Expo app: phase editor
- Android / Expo app: initial scaffold (React Native / Expo, SQLite, offline-first)

## [1.8.0] — 2025-01-01
### Added
- Session Templates — save any session as a named template; apply on new session creation; manage in Settings; included in backup/restore
- Google Drive Backup — OAuth2 connect; manual, daily, or on-change backup modes; timestamped JSON uploads; restore any previous backup from Settings
- Appearance Settings — theme color picker (6 presets + custom HSL); font size (small/medium/large); CSS variable swap; persisted to localStorage and server-synced
- Preferences Settings — date format options; default session duration pre-fill; persisted and server-synced
- Multiple Active Sessions — all sessions in unified sidebar; click to toggle open/closed; `SessionPane.jsx` extracted as self-contained component
- Shopping List — post-calculate modal with all shortfall items, grand total, one-click clipboard copy

## [1.7.0] — 2025-01-01
### Added
- Dark / Light / System mode toggle — CSS variable swap; system mode follows `prefers-color-scheme`
- PDF Export — jsPDF + jspdf-autotable; session header, results table, grand total; client-side only
- Support section in Settings (hidden pending Ko-fi / GitHub Sponsors setup)

## [1.6.0] — 2025-01-01
### Added
- Running Low alerts — per-supplement reorder threshold; ⚠ badge on supplement row; daily 8am push notification
- Adherence Tracking — 30-day dot grid per regimen; adherence %; taken/skip log buttons with undo; bulk "mark all" bar; SW notification tap logging
- CSV Export — post-calculate download of session results; no new dependencies

## [1.5.0] — 2025-01-01
### Added
- Dose Reminders — Web Push (VAPID); per-regimen reminder time picker; subscribe/unsubscribe in Settings; server-side cron (every minute); test notification button
- Liquid & Drops support — ml/drops unit type; drops_per_ml override; decimal inventory; ml↔drops conversion in calculator

## [1.4.0] — 2025-01-01
### Added
- Data backup, restore, and clear — full DB + prefs exported as JSON; restore wipes and re-imports
- Settings page — full-screen tab; collapsible sections; SVG cog icon in nav
- About section — version, description, GitHub link, MIT license
- Version endpoint — `GET /version` reads from package.json; shown in Settings footer

## [1.3.0] — 2025-01-01
### Added
- Quick inventory adjustment — +/− buttons on supplement rows
- Grand total cost across all regimens in calculate results
- Copy session — clone all regimens and phases to a new session

## [1.2.0] — 2025-01-01
### Added
- Days-of-week dosing — schedule regimens on specific days only
- Indefinite phase support — fills the rest of the session; stored as 9999 days with `indefinite = true`
- Per-regimen notes with auto-save
- Delete confirmations for sessions, regimens, supplements

## [1.1.0] — 2025-01-01
### Added
- Mobile touch-friendly UI — tap to edit, hidden icons, responsive action buttons
- Session date validation — target must be after start
- Block calculate when a regimen has no phases
- Collapse/expand regimen cards and sessions sidebar

## [1.0.0] — 2025-01-01
### Added
- Core shortfall calculator — pills consumed, real-time on-hand, shortfall, bottles, cost, days of coverage
- Supplement inventory management
- Session, regimen, and phase management
- PostgreSQL backend with Docker Compose
- React + Vite + Tailwind CSS frontend
