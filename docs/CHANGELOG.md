# Changelog

## [Unreleased]
### Added
- Web (server): a Take With Food flag on supplements and an As Needed flag on regimens (excluded from shortfall and days-remaining math); both are kept by copy, templates and backups
- Web (server): meal-time dosing foundation — each phase now takes Breakfast / Lunch / Dinner amounts plus up to 12 custom time+amount doses, stored as `dose_morning/lunch/dinner` and a `custom_slots` JSON list; the shortfall calculator sums them, fractional amounts work for every unit, and existing single doses migrate to Breakfast automatically. The editor, notifications and other flows follow in later commits
- Web: password login (server side) — every API route now requires a session except `/health`, `/auth/login` and `/auth/me`. scrypt password hash in `APP_PASSWORD_HASH` (the backend refuses to start without it; generate with `node scripts/hash-password.js`), DB-backed sessions in an HttpOnly cookie, CSRF header check, login/API rate limiting, and a `state` check on the Google Drive connect flow. `POST /restore` now rejects empty/malformed backups instead of wiping the database, and accepts backups up to 25 MB
- Web: sign-in screen and a Session card in Settings (Log out / Log out everywhere); an expired or revoked session drops back to the sign-in screen, and a server outage shows a Retry state instead of a misleading login form
- Android app: time-of-day dosing — each phase takes Morning / Lunch / Dinner amounts plus any number of custom time+amount slots; the shortfall calculator sums them
- Android app: Reminder Times in Settings (Morning / Lunch / Dinner defaults); per-regimen multi-slot reminders replace the single reminder picker; all reminders are rescheduled on launch
- Android app: session templates — save a session as a template, apply it when creating a new session, manage in Settings
- Android app: collapsible Settings sections, font size preference, default session duration (pre-fills new session target date)
- Android app: phase labels show time-of-day doses; the active phase shows a days-left badge
### Changed
- Backups are now version 2 (they include the new dosing fields); older version-1 files still restore, with their single dose becoming the Breakfast dose, and files from a newer version are refused instead of silently zeroing doses
- Days-remaining and the low-stock alert now use each regimen's currently active phase at its full daily total, summed across regimens, in your timezone (previously the first phase of an arbitrary regimen)
- Dependencies upgraded to clear known vulnerabilities: `jspdf` 4.2.1, `dompurify` 3.4.15, `fflate` 0.8.3 (web); `express` 4.22.3 (pulls patched `qs` 6.16), `node-cron` 4.6 (drops vulnerable `uuid`) (server); `npm audit` now reports 0 vulnerabilities for both the web client and the server (vite 8.3, postcss, nanoid, js-yaml, browserslist and others updated via `npm audit fix`)
- `tailwindcss` / `@tailwindcss/vite` 4.3.3 — they now support vite 8, so `client/Dockerfile` installs without `--legacy-peer-deps`
- Android app: preferences now stored in AsyncStorage with a synchronous cache
- Android app: CSV export and JSON backup/restore use `expo-file-system/next`
- Android app: font sizes are rem-based so the font size preference scales all text
### Fixed
- Copying a session no longer drops the indefinite flag on its phases
- Changing a regimen's As Needed flag (or notes) no longer wipes the other field
- The login concurrency cap now still holds while the failed-login slowdown is active
- Adding a phase after deleting one in the middle no longer fails (the server now assigns the phase order)
- Shortfall math no longer misjudges coverage on decimal doses (e.g. 0.1 three times a day against 0.3)
- Web: the add/edit supplement form now accepts whole numbers (e.g. 30 capsules per bottle). It previously demanded values like 29.001 because the field's `min` and `step` didn't line up
- Removed stray `// @atlas-entrypoint` comment lines from source files; one in `client/package-lock.json` broke `npm audit`
- Android app: headers and modals respect safe areas on Android 15 edge-to-edge; Add Regimen button clears the system nav bar
- Android app: hardware back button closes modals
- Android app: date format preference applies to date fields
- Android app: adherence calendar no longer drifts a day in non-UTC timezones
- Android app: tapping a dose notification logs the dose; notification handler registered at startup
- Android app: backup restore runs in a single transaction so a failed restore can't leave partial data
- Android app: saving a supplement now shows an error instead of failing silently; the supplement modal clears the Android nav bar
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
