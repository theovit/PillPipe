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
working tree, `client/package-lock.json`); removed 2026-09-19. JSON can't have comments, so
`npm audit` failed with ENOLOCK and `npm ci` would too. If `npm` complains about the lockfile,
check line 1 — the writer may be back.

**Investigated 2026-09-22, still not fully explained.** All 5 removed comments trace (via
`git log -p --follow`) to ordinary feature commits on 2026-03-23/24 co-authored by Claude Sonnet
4.6, e.g. `2a69bb1` (`SettingsScreen.tsx`) — the comment lands as the first added line in a diff
that's otherwise unrelated feature work, always tagged `// @atlas-entrypoint: App — substantial
file` or similar. No hook, script, or setting in this repo's `.claude/`, the global
`~/.claude/settings.json`, or the current plugin cache mentions "atlas" (the only string hits are
`atlan`/`atlassian` substring matches — false positives). So it wasn't this repo's config and isn't
a currently-installed plugin. Best guess: a plugin or tool active in whatever session made those
March edits (name suggests an auto-tagging/context tool, maybe a predecessor to `vexp`) that has
since been uninstalled or renamed, leaving no trace to grep for. Can't confirm further without that
session's own logs. If the comments come back, note the exact session/commit and check active
plugins at that time.

## Service worker handles dose-tap notifications
When a user taps a dose reminder push notification, the service worker intercepts the tap and
posts a message to `SessionPane`. `SessionPane` listens for this message and calls the dose-log
API. If notification taps are not logging doses, check the SW message listener in `SessionPane.jsx`.

## The backend won't start without `APP_PASSWORD_HASH`
By design (fail closed). Generate one with `docker compose run --rm backend node scripts/hash-password.js`
and put the printed line in `.env` (no quotes). The hash uses `:` separators because Compose interpolates
`$` in `.env`/`environment:` values and would corrupt a `$`-style hash. Until it is set, `docker compose up`
leaves the backend exiting with that message.

## Auth tests are destructive — use the throwaway stack only
`server/test/auth.test.js` fires `DELETE /data` and `POST /restore` on purpose and refuses non-localhost
URLs. Run them against `docker-compose.test.yml` (project `pillpipe-test`, Postgres on tmpfs, port 13000);
the setup commands are in that file's header. Tests give each request a unique `X-Forwarded-For` because
the backend trusts one proxy hop and rate-limits per IP.

## Running the Vite dev server on the host against another backend
`API_TARGET=http://127.0.0.1:13000 npx vite --port 5199 --host 127.0.0.1` in `client/` proxies `/api` to that
backend instead of `http://backend:3000`. The backend's `APP_ORIGIN` must equal the browser origin exactly
(here `http://127.0.0.1:5199`) or every POST/PUT/DELETE gets a 403 from the CSRF check. The test compose file
reads `TEST_APP_ORIGIN`, `TEST_IDLE_TTL`, `TEST_ABS_TTL` for this.

## Current data is fake test data — no migrations needed to preserve it
The owner confirmed (2026-09-19) that everything in the dev database is throwaway test data. Schema changes
(e.g. multi-user ownership columns) do not need data-preserving migrations; wiping and reseeding is fine.
Revisit this the moment real data goes in (i.e. before the app is used for real over the internet).

## node-pg: JSONB arrays must be stringified; NUMERIC and DATE arrive oddly
`custom_slots` is JSONB. pg serializes a JS *array* parameter as a Postgres array literal (an error for JSONB), so always pass `JSON.stringify(slots)` (objects are fine). NUMERIC columns come back as strings (`Number()` them; round to 1e-6 before comparing). DATE columns come back as local-midnight `Date` objects — in SQL use `to_char(d, 'YYYY-MM-DD')` and do day math on strings with `Date.UTC` (`server/dosing.js`).

## Running the tests
`cd server && npm run test:unit` needs nothing. `npm test` also runs the API/auth tests, which need the throwaway stack:
`export TEST_APP_PASSWORD_HASH=$(echo 'correct-horse-battery' | node server/scripts/hash-password.js | sed -n 's/^APP_PASSWORD_HASH=//p')`, then `docker compose -p pillpipe-test -f docker-compose.test.yml up -d --build --force-recreate --wait`, then `cd server && TEST_PASSWORD=correct-horse-battery npm test` (files run one at a time). Tear down with `down -v`. Never point them at a real instance — they refuse non-localhost URLs.

## The service worker can't be exercised with a real push in tests
`server/test/sw.test.js` loads `client/public/sw.js` into a Node `vm` sandbox and drives its `push` / `notificationclick` handlers with stubs. Real delivery (VAPID, the browser's push service, action buttons — unsupported on iOS Safari and desktop Firefox) still needs a manual check on a device.

## Prod on Unraid: first boot, the app races Postgres init
On a fresh volume the `db` healthcheck (`pg_isready`, over the Unix socket) passes while the
entrypoint's *temporary* init server is up, so `app` starts and then gets ECONNREFUSED when that
server stops for the real start. `restart: unless-stopped` recovers it within a minute. Unraid's
disk is slow enough (initdb ~1–2 min) that `up --wait` can report db unhealthy on first run; just
wait and re-run `up -d`. Unraid has no `docker compose` unless the Compose Manager plugin is installed.
The stack shows in its UI via an "indirect" entry: `/boot/config/plugins/compose.manager/projects/pillpipe/`
(`name`=pillpipe, `indirect`=the repo's `docker-compose.prod.yml`, `indirect_mode`=file).
