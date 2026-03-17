# Memory

## File watching requires polling on Windows + Docker
inotify does not work reliably across the Windows/Docker volume boundary. Both Vite (`vite.config.js`)
and nodemon (`server/nodemon.json`) must use polling mode (`usePolling: true`, 300–500ms intervals).
If hot reload stops working, check these configs first.

## init.sql only runs on first container start
`db/init.sql` is only executed when the Docker volume is empty (first run). All subsequent schema
changes must be added as `ALTER TABLE IF NOT EXISTS` statements in `server/index.js` at boot time.
Never rely on init.sql for schema migrations.

## Indefinite phases use 9999 + boolean flag — not NULL
Indefinite phase duration is stored as `duration_days = 9999` with `indefinite = true`. Do not
change this to NULL — null propagates through the calculator and breaks every downstream calculation.
The `indefinite` boolean is the authoritative source of truth.

## Frontend port is not the backend
The app runs on port 5173 (Vite). The backend runs on port 3000 but is not exposed to the host —
it is only reachable via Docker internal DNS (`http://backend:3000`). The Vite proxy handles
`/api/*` forwarding. Do not try to call the backend directly from the browser.

## Google Drive tokens are stored in the database
OAuth2 tokens for Google Drive backup are persisted in the `settings` table (not in a file or
environment variable). If Google auth breaks, check the `settings` table for the token entry.

## Backup JSON includes client prefs
The backup/restore payload includes both database content and client-side preferences (appearance,
date format, default duration, etc.). When adding new preference fields, ensure they are included
in the backup serialization in both the export and restore paths.

## Service worker handles dose-tap notifications
When a user taps a dose reminder push notification, the service worker intercepts the tap and
posts a message to `SessionPane`. `SessionPane` listens for this message and calls the dose-log
API. If notification taps are not logging doses, check the SW message listener in `SessionPane.jsx`.
