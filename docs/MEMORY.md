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

## HTML number inputs: `step` is anchored to `min`
A `<input type="number" min="0.001" step="1">` only accepts 0.001, 1.001, 2.001… — so "30" is rejected
with "enter a valid value". Whenever `min` is not a multiple of `step`, whole numbers fail. Keep `min`
equal to (or a multiple of) `step`. This was the "won't accept 30 when adding a pill" bug in
`SupplementsPanel.jsx` (see `docs/TODO.md`).

## Local `client/node_modules` can be stale
`npm run build` locally fails with "failed to resolve import jspdf" because `jspdf` /
`jspdf-autotable` are declared in `client/package.json` but were never installed on the host (the
Docker container installs its own). Run `npm install` in `client/` before a local build. Lint works
without it. (`--legacy-peer-deps` is no longer needed since `tailwindcss`/`@tailwindcss/vite` 4.3.3
support vite 8 — if an ERESOLVE peer conflict reappears, check for a package pinned to an old vite.)

## Docker keeps a stale `node_modules` after dependency changes
`docker-compose.yml` bind-mounts `./server` and `./client` and masks `node_modules` with an anonymous
volume. `docker compose up --build` **reuses the old volume**, so containers keep running the old
dependency versions (this hid the express/node-cron upgrade until checked). After changing
`package.json`/lockfiles run `docker compose up --build -V` (renews anonymous volumes; the named
`postgres_data` volume is untouched). Verify with `docker compose exec backend npm ls --all`.

## A junk first-line comment in `package-lock.json` breaks npm
Stray `// @atlas-entrypoint: …` lines were being written at the top of source files (and, in the
working tree, `client/package-lock.json`); removed 2026-09-19, source of the writer unconfirmed. JSON
can't have comments, so `npm audit` failed with ENOLOCK and `npm ci` would too. If `npm` complains
about the lockfile, check line 1 — the writer may be back.

## Service worker handles dose-tap notifications
When a user taps a dose reminder push notification, the service worker intercepts the tap and
posts a message to `SessionPane`. `SessionPane` listens for this message and calls the dose-log
API. If notification taps are not logging doses, check the SW message listener in `SessionPane.jsx`.
