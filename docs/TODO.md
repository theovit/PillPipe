# TODO

## WIP
- [ ] Web app cleanup and hardening — get the web app clean, correct and safe to reach from the internet, *then* resume the Android port

## Blockers before exposing the web app to the internet
**Paused until the app has been tested (decided 2026-09-19).** Remote access stays on Tailscale for now; nothing here is urgent while the app is not internet-facing. Login, CSRF, rate limits and the OAuth `state` check are built on branch `auth` (see Authentication below). If/when the app is exposed, the plan is to put it behind the existing nginx proxy on the Unraid server (proxy 10.0.0.4, Unraid host 10.0.0.25) instead of a Cloudflare Tunnel, so the production-serving/HTTPS items below get adapted to that proxy. Do not expose the app until production serving, HTTPS and the snapshot-before-wipe safeguard are done.
- [ ] **Authentication** — built on branch `auth` (server + sign-in screen; 21 API tests + a 19-step Edge browser run pass) but **not merged or deployed**. Before running the dev stack you must add `APP_PASSWORD_HASH` to `.env` (see `docs/MEMORY.md`). Exposure to the internet still needs the production stack + HTTPS below.
- [ ] **Production serving** — Docker currently runs the Vite dev server (`npm run dev -- --host`, `allowedHosts: true`) and nodemon with source bind-mounts. Build the client (`vite build`) and serve static files (Express or nginx/Caddy); run the backend with `node`; add a production compose file without bind mounts.
- [ ] **HTTPS/TLS** — terminate at a reverse proxy (Caddy/nginx) or tunnel; HSTS; `trust proxy`; Secure cookies. Service workers and Web Push require HTTPS anyway.
- [ ] Security headers — server-side nosniff/no-store/`x-powered-by` off, rate limits and body limits are done (M1b). Remaining: nginx CSP and headers (M3), self-hosted fonts, restrict Vite `allowedHosts` in dev.
- [ ] Input validation — none today. Validate/coerce every request body (e.g. zod), return 400s, and confirm the error handler doesn't leak stack traces or DB errors. (SQL is already parameterized — no string interpolation found in `server/index.js`.)
- [ ] Protect destructive endpoints — require re-auth/confirmation for `DELETE /data`, `/restore`, `/drive/restore`; take an automatic backup before any restore.
- [ ] Secrets — Google OAuth tokens sit in plaintext in `google_tokens`: encrypt at rest or document the risk. Use strong unique DB password/VAPID keys; keep them out of images and logs.
- [ ] Reproducible, auditable installs — `server/package-lock.json` is now tracked (M1b). Remaining: use `npm ci` in both Dockerfiles and make `npm audit` part of every release.
- [ ] Network exposure — publish only the reverse proxy (443). Keep the backend (3000) and Postgres (5432) on the internal Docker network (true today); firewall the host.
- [ ] Automated tests for auth and the destructive routes before going live (DECISIONS "No automated tests" needs revisiting for these).

## High
- [ ] **Verify batched push on a real device.** Web Push can't run in the test stack (no VAPID keys or real push service), so the reminder logic is covered by unit tests only (`dueNotifications`, payload, the service worker in a sandbox). Manually: enable notifications, set a dose time to now+2 min, confirm ONE notification listing everything due; tap Taken with the app closed and check `dose_log`; confirm low-stock and test pushes have no buttons.
- [ ] Follow-ups from the meal-time port:
  - [ ] Per-slot dose logging — `dose_log` is one row per regimen per day, so a notification tap only logs regimens with a single dose that day
  - [ ] Low-stock cron (`0 8 * * *`) runs in server time (UTC); should use the owner's timezone. Also delete push subscriptions on 404, not only 410, in that sender
  - [ ] `/pill-icon.png` (notification icon) doesn't exist in `client/public`
  - [ ] `server/calculator.js` still computes days elapsed from the server's local "today"
  - [ ] Web backup omits `dose_log` (a restore wipes adherence history)
  - [ ] Session copy still drops regimen notes; docs claiming it "clones regimens and phases" are only now accurate for phases
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
