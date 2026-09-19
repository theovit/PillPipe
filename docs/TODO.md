# TODO

## WIP
- [ ] Web app cleanup and hardening — get the web app clean, correct and safe to reach from the internet, *then* resume the Android port

## Blockers before exposing the web app to the internet
Context (decided 2026-09-19): single user, reachable over the internet — not public sign-up. Today there is **no authentication**, and one unauthenticated request can wipe the database (`DELETE /data`, `POST /restore`, `POST /drive/restore/:fileId`). Do not expose the app until at least auth, production serving and HTTPS are done.
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
- [ ] Meal-time dosing — web/server port. Android already has it (fixed `dose_morning/lunch/dinner/custom` columns + `custom_slots` JSON on phases, Morning/Lunch/Dinner time prefs, per-regimen multi-slot notifications; see DECISIONS) but web/server still use a flat `dosage`. Remaining:
  - [ ] Schema, Settings meal-time pickers, phase editor, calculator, backup/templates on web
  - [ ] Web notification overhaul — batched per-time-slot push; replaces per-regimen `reminder_time`
  - [ ] Compact slot notation on regimen cards (B1 L1 D2)
  - [ ] "Take With Food" flag on supplement record
  - [ ] "As Needed" dosing — UI-only flag on regimen; no slots, no notifications, no inventory math; shows "As Needed" label on card
- [ ] Find what writes `// @atlas-entrypoint: …` first-line comments into source files (removed 2026-09-19; source unconfirmed) — if it re-adds them, disable it.
- [ ] Remove the obsolete `version:` key from `docker-compose.yml` (Compose warns on every command).

## On hold (until the web app is clean and hardened)
- [ ] Android app — React Native / Expo; offline-first SQLite; parity pass paused 2026-09-19. Granular status in `app/TODO.md`.
  - [ ] Dependency vulnerabilities not yet addressed: 35 in `npm audit --omit=dev` (2 critical, 18 high — Expo/RN tooling, `ws`, `yaml`)

## Long-term
- [ ] Flexible Ads — opt-in ad system (ad-free default); AdSense; four levels; deferred until larger public user base
- [ ] Doctor Portal — multi-tenant support for healthcare providers; requires multi-user auth + user/role model (single-user auth is in Blockers above)
- [ ] Activate Donate / Support section — remove `false &&` guard in Dashboard.jsx once Ko-fi / GitHub Sponsors pages are live
