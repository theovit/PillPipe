# TODO

## WIP
- [ ] Web app cleanup and hardening — get the web app clean, correct and safe to reach from the internet, *then* resume the Android port

## Blockers before exposing the web app to the internet
**Deadline: Tuesday 2026-09-29** (set 2026-09-23). Path: `Internet → Cloudflare Tunnel → Nginx
Proxy Manager (Unraid, pill.1044nma.com) → PillPipe`, all on the Unraid server (10.0.0.25) — see
`docs/DECISIONS.md` 2026-09-23 entry (supersedes the earlier "nginx instead of tunnel" plan). The
production stack now runs on Unraid (2026-09-26): repo cloned at `/mnt/user/appdata/pillpipe`
(branch `meal-time`), `docker compose -p pillpipe -f docker-compose.prod.yml up -d --build`,
app on `10.0.0.25:3000`, fresh DB, its own `.env` there. NPM points at it and was switched to
**Publicly Accessible on 2026-09-27** — verified through Cloudflare (200 `/health`, 401 unauthenticated,
real client IP in logs). Single-user auth only for this milestone — multi-user login is separately
scoped under Long-term.

- [ ] **Google Drive in prod** — credentials + `GOOGLE_REDIRECT_URI` are in the Unraid `.env`, but
  connecting fails with `redirect_uri_mismatch`: add `https://pill.1044nma.com/api/auth/google/callback`
  to the OAuth client's Authorized redirect URIs and add the owner as a test user (consent screen is in
  Testing). Done when `google_tokens` has a row.
- [ ] **Unraid cache SSD** — dropped off the SATA bus 2026-09-26 (pool went read-only); fine after
  reboot. Check SMART + run a btrfs scrub; replace if it recurs. All appdata (incl. PillPipe) lives on it.

**Corrected 2026-09-23** — this list had drifted from the actual code: Authentication was marked
not-merged (false: it's `server/auth.js`, merged into `meal-time` at 8accd86, and live — confirmed
by an actual login) and the "no automated tests" note for auth was stale (`server/test/auth.test.js`
already covers it extensively). Both fixed below; re-verify against the code before trusting this
list again next time, don't just take it at face value.

- [x] **Authentication** — password login, DB-backed sessions, CSRF, rate limits, OAuth `state`
  check, hardening headers. Merged into `meal-time`, live in the dev stack. `APP_PASSWORD_HASH`
  must be in `.env` (see `docs/MEMORY.md`). `server/test/auth.test.js` covers it.
- [x] **Production serving** — `Dockerfile.prod` + `docker-compose.prod.yml`: multi-stage build (client `vite build` → server's `./public`), served by Express (`SERVE_CLIENT` in `server/index.js`) ahead of the auth gate, backend runs with `node`, no bind mounts. `docker-compose.yml` (dev, Vite + nodemon + bind mounts) is unchanged and still the default for local work.
- [ ] **HTTPS/TLS** — terminate at a reverse proxy (Caddy/nginx) or tunnel; HSTS; `trust proxy`; Secure cookies (`COOKIE_SECURE`). Service workers and Web Push require HTTPS anyway. Deployment-side (Unraid nginx) as much as app-side.
- [x] Security headers — nosniff/no-store/`x-powered-by` off, rate/body limits, CSP (in-app, only on `SERVE_CLIENT`/production responses — see `server/index.js`), self-hosted fonts, and `allowedHosts` restricted in dev (`localhost`/`127.0.0.1`/`pill.1044nma.com`). Not done: nginx/NPM's own headers on the Unraid side — app-level CSP is defense in depth, not a substitute for whatever NPM adds at the proxy.
- [x] Input validation — zod schemas (`server/validation.js`) on every previously-unvalidated route body; phases/backup-restore/push-subscribe already had their own. Error handler already hid stack traces/DB errors (unchanged); `server/test/validation-api.test.js` proves bad input gets a clean 400.
- [x] Protect destructive endpoints — `DELETE /data`, `POST /restore`, `POST /drive/restore/:fileId` now require an `X-Confirm-Password` header (`auth.requireCurrentPassword`), and each takes an automatic pre-wipe snapshot (`pre_restore_snapshots`, capped at 5, no restore-from-snapshot endpoint yet — recovery is a manual query).
- [x] Secrets — Google OAuth tokens now AES-256-GCM encrypted at rest (`server/tokenCrypto.js`), key in `TOKEN_ENCRYPTION_KEY`; server fails closed at boot if `GOOGLE_CLIENT_ID` is set without it. DB password and VAPID keys are strong/unique in this dev `.env` (2026-09-23) — production deployment needs its own values for all of these (DB password, VAPID keys, `TOKEN_ENCRYPTION_KEY`, `APP_PASSWORD_HASH`).
- [x] Reproducible installs — both Dockerfiles use `npm ci`; `npm audit --audit-level=high` is now Step 1.5 of the `release-prep` skill (`~/.claude/skills/release-prep/SKILL.md`, outside this repo). Both server and client currently audit clean.
- [x] Network exposure — backend (3000) and Postgres (5432) already internal-only in `docker-compose.yml` (not published to the host). Publishing only the reverse proxy and firewalling the host is a deployment step on the Unraid side, not a code change.
- [x] Automated tests for the destructive-route protections above (`server/test/auth.test.js`).

## High
- [ ] **Verify batched push on a real device.** Web Push can't run in the test stack (no VAPID keys or real push service), so the reminder logic is covered by unit tests only (`dueNotifications`, payload, the service worker in a sandbox). Manually: enable notifications, set a dose time to now+2 min, confirm ONE notification listing everything due; tap Taken with the app closed and check `dose_log`; confirm low-stock and test pushes have no buttons.
- [ ] Follow-ups from the meal-time port:
  - [ ] Per-slot dose logging — `dose_log` is one row per regimen per day, so a notification tap only logs regimens with a single dose that day
  - [ ] Low-stock cron (`0 8 * * *`) still runs in server time (UTC); should use the owner's timezone (the 404 push-subscription cleanup for this sender was fixed 2026-09-22)
  - [ ] `/pill-icon.png` (notification icon) doesn't exist in `client/public`
  - [ ] Root `README.md` / `INSTALL.md` / `FEATURES.md` still describe an older design in places — reconcile with `docs/`
- [ ] Web: edit existing regimens — there's no way to change a regimen after it's created, so a wrong date can't be fixed (only delete and re-add). Needs an edit flow for the regimen and its phases (dates included). (Noted 2026-09-29)
- [ ] Web: supplement description — an optional free-text field on each supplement (Supplements tab) to note what it's for; show it on the supplement card, keep it in copy, templates and backups. (Noted 2026-09-29)
- [ ] Find what writes `// @atlas-entrypoint: …` first-line comments into source files (removed 2026-09-19). Investigated 2026-09-22: traced to ordinary Claude-Sonnet-4.6-co-authored commits on 2026-03-23/24, but no current hook/plugin/setting references "atlas" — likely a now-uninstalled tool. See `docs/MEMORY.md`. Watch for recurrence; can't fully close without more evidence.

## On hold (until the web app is clean and hardened)
- [ ] Android app — React Native / Expo; offline-first SQLite; parity pass paused 2026-09-19. Granular status in `app/TODO.md`.
  - [ ] Dependency vulnerabilities not yet addressed: 35 in `npm audit --omit=dev` (2 critical, 18 high — Expo/RN tooling, `ws`, `yaml`)

## Long-term
- [ ] Android app: optional remote server mode — Settings gets a field for a hosted PillPipe server's public address; user can push local data up (seed a fresh server from the app) or pull server data down (seed the app from an existing server), then choose to keep syncing (server as ongoing shared store / offsite backup) or go local-only after the initial pull. App stays fully standalone/offline-first by default when no address is set. Full breakdown, incl. conflict resolution and network-loss handling: `app/TODO.md` "Sync / Remote Server Mode". Real multi-person use also needs the multi-user login item below — a URL field alone doesn't give each person their own account.
- [ ] Multi-user login — support several accounts instead of the single shared password: per-user credentials, per-user data ownership (supplements, sessions, regimens, dose logs, prefs, Drive tokens), per-user push subscriptions and backups, and account management. Builds on the single-user auth; needs a users table and an owner column on each data table. No data migration needed — the current data is fake test data and can be wiped. Prerequisite for the Doctor Portal. (Noted 2026-09-23:)
  - [ ] First launch of a fresh install (no users yet) prompts to create the first account as admin, instead of a shared setup password
  - [ ] A role/permission column on the users table (e.g. `is_admin` or a `role` enum) — more than one user can be an administrator, not just the first account
- [ ] Flexible Ads — opt-in ad system (ad-free default); AdSense; four levels; deferred until larger public user base
- [ ] Doctor Portal — multi-tenant support for healthcare providers; requires multi-user auth + user/role model (single-user auth is in Blockers above). Back burner — owner wants to experiment with a provider portal once multi-user login is done; details to be worked out then. (Noted 2026-09-29)
- [ ] Activate Donate / Support section — remove `false &&` guard in Dashboard.jsx once Ko-fi / GitHub Sponsors pages are live
