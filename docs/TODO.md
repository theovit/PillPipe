# TODO

## WIP
- [ ] Web app cleanup and hardening — get the web app clean, correct and safe to reach from the internet, *then* resume the Android port

## Blockers before exposing the web app to the internet
**Deadline: Tuesday 2026-09-29** (set 2026-09-23). Path: `Internet → Cloudflare Tunnel → Nginx
Proxy Manager (Unraid, pill.1044nma.com) → PillPipe`, all on the Unraid server (10.0.0.25) — see
`docs/DECISIONS.md` 2026-09-23 entry (supersedes the earlier "nginx instead of tunnel" plan). The
production stack itself needs to move from this Windows dev machine to Unraid. Single-user auth
only for this milestone — multi-user login is separately scoped under Long-term. NPM currently
points at the Windows dev stack and is set to local-only access (not public); do not flip it
public until production serving, HTTPS, input validation, destructive-endpoint protection and the
snapshot-before-wipe safeguard are done.

**Corrected 2026-09-23** — this list had drifted from the actual code: Authentication was marked
not-merged (false: it's `server/auth.js`, merged into `meal-time` at 8accd86, and live — confirmed
by an actual login) and the "no automated tests" note for auth was stale (`server/test/auth.test.js`
already covers it extensively). Both fixed below; re-verify against the code before trusting this
list again next time, don't just take it at face value.

- [x] **Authentication** — password login, DB-backed sessions, CSRF, rate limits, OAuth `state`
  check, hardening headers. Merged into `meal-time`, live in the dev stack. `APP_PASSWORD_HASH`
  must be in `.env` (see `docs/MEMORY.md`). `server/test/auth.test.js` covers it.
- [ ] **Production serving** — Docker currently runs the Vite dev server (`npm run dev -- --host`, `allowedHosts: true`) and nodemon with source bind-mounts. Build the client (`vite build`) and serve static files (Express or nginx/Caddy); run the backend with `node`; add a production compose file without bind mounts.
- [ ] **HTTPS/TLS** — terminate at a reverse proxy (Caddy/nginx) or tunnel; HSTS; `trust proxy`; Secure cookies (`COOKIE_SECURE`). Service workers and Web Push require HTTPS anyway. Deployment-side (Unraid nginx) as much as app-side.
- [ ] Security headers — server-side nosniff/no-store/`x-powered-by` off, rate limits and body limits are done. Remaining: CSP (nginx or in-app), self-hosted fonts (currently Google Fonts CDN in `client/index.html`), restrict Vite `allowedHosts` in dev.
- [x] Input validation — zod schemas (`server/validation.js`) on every previously-unvalidated route body; phases/backup-restore/push-subscribe already had their own. Error handler already hid stack traces/DB errors (unchanged); `server/test/validation-api.test.js` proves bad input gets a clean 400.
- [ ] Protect destructive endpoints — `DELETE /data`, `POST /restore`, `POST /drive/restore/:fileId` have no re-auth/confirmation step today; take an automatic backup before any restore.
- [x] Secrets — Google OAuth tokens now AES-256-GCM encrypted at rest (`server/tokenCrypto.js`), key in `TOKEN_ENCRYPTION_KEY`; server fails closed at boot if `GOOGLE_CLIENT_ID` is set without it. DB password and VAPID keys are strong/unique in this dev `.env` (2026-09-23) — production deployment needs its own values for all of these (DB password, VAPID keys, `TOKEN_ENCRYPTION_KEY`, `APP_PASSWORD_HASH`).
- [x] Reproducible installs — both Dockerfiles use `npm ci` now. Remaining: make `npm audit` part of every release.
- [x] Network exposure — backend (3000) and Postgres (5432) already internal-only in `docker-compose.yml` (not published to the host). Publishing only the reverse proxy and firewalling the host is a deployment step on the Unraid side, not a code change.
- [ ] Automated tests for the destructive-route protections above, once built (auth itself is already covered).

## High
- [ ] **Verify batched push on a real device.** Web Push can't run in the test stack (no VAPID keys or real push service), so the reminder logic is covered by unit tests only (`dueNotifications`, payload, the service worker in a sandbox). Manually: enable notifications, set a dose time to now+2 min, confirm ONE notification listing everything due; tap Taken with the app closed and check `dose_log`; confirm low-stock and test pushes have no buttons.
- [ ] Follow-ups from the meal-time port:
  - [ ] Per-slot dose logging — `dose_log` is one row per regimen per day, so a notification tap only logs regimens with a single dose that day
  - [ ] Low-stock cron (`0 8 * * *`) still runs in server time (UTC); should use the owner's timezone (the 404 push-subscription cleanup for this sender was fixed 2026-09-22)
  - [ ] `/pill-icon.png` (notification icon) doesn't exist in `client/public`
  - [ ] Root `README.md` / `INSTALL.md` / `FEATURES.md` still describe an older design in places — reconcile with `docs/`
- [ ] Find what writes `// @atlas-entrypoint: …` first-line comments into source files (removed 2026-09-19). Investigated 2026-09-22: traced to ordinary Claude-Sonnet-4.6-co-authored commits on 2026-03-23/24, but no current hook/plugin/setting references "atlas" — likely a now-uninstalled tool. See `docs/MEMORY.md`. Watch for recurrence; can't fully close without more evidence.

## On hold (until the web app is clean and hardened)
- [ ] Android app — React Native / Expo; offline-first SQLite; parity pass paused 2026-09-19. Granular status in `app/TODO.md`.
  - [ ] Dependency vulnerabilities not yet addressed: 35 in `npm audit --omit=dev` (2 critical, 18 high — Expo/RN tooling, `ws`, `yaml`)

## Long-term
- [ ] Multi-user login — support several accounts instead of the single shared password: per-user credentials, per-user data ownership (supplements, sessions, regimens, dose logs, prefs, Drive tokens), per-user push subscriptions and backups, and account management. Builds on the single-user auth; needs a users table and an owner column on each data table. No data migration needed — the current data is fake test data and can be wiped. Prerequisite for the Doctor Portal.
- [ ] Flexible Ads — opt-in ad system (ad-free default); AdSense; four levels; deferred until larger public user base
- [ ] Doctor Portal — multi-tenant support for healthcare providers; requires multi-user auth + user/role model (single-user auth is in Blockers above)
- [ ] Activate Donate / Support section — remove `false &&` guard in Dashboard.jsx once Ko-fi / GitHub Sponsors pages are live
