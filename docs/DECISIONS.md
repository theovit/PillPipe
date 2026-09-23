# Decisions

## Web app will be internet-reachable (single user) — authentication + hardening required
**Date:** 2026-09-19
**Decision:** The web interface will be reachable from the internet by its one owner. That supersedes "No authentication layer" and "Tailscale for remote access" below: authentication, production serving, HTTPS and hardening are prerequisites (see Blockers in `docs/TODO.md`). Android work is paused until the web app is clean and hardened.
**Why:** The owner wants access from anywhere without depending on a VPN. Exposing the current app as-is would let anyone read or wipe the data (`DELETE /data`, `POST /restore`).
**Alternatives considered:** Staying Tailscale-only (still valid as defense in depth); an identity-aware proxy in front (Cloudflare Access / Tailscale Funnel) vs. built-in login — to be decided when auth is implemented.
**Consequences:** Multi-user/public sign-up is still out of scope. Every route needs an auth check; the dev-server Docker setup can no longer be the deployed form.

## Internet exposure deferred; Tailscale stays; existing nginx proxy replaces the Cloudflare Tunnel plan (superseded 2026-09-23)
**Date:** 2026-09-19
**Decision:** Do not expose the web app to the internet until it has been tested. Remote access stays on Tailscale. When exposure happens, front it with the nginx proxy that already runs on the Unraid server (proxy 10.0.0.4, host 10.0.0.25) rather than a Cloudflare Tunnel.
**Why:** The app is still being tested with fake data, so hardening work beyond the login is not urgent; the owner already runs a reverse proxy and would rather reuse it than add a tunnel and a domain on Cloudflare.
**Alternatives considered:** Cloudflare Tunnel (previous plan, see the 2026-09-19 authentication entry).
**Consequences:** Production serving, TLS/headers and the destructive-endpoint safeguards (M3/M4 in `docs/TODO.md`) stay open but paused. Rate limiting keys on `req.ip`, so the proxy must overwrite `X-Forwarded-For` and the backend must be reachable only through it. The login itself stays useful behind Tailscale.

## Internet exposure: back to Cloudflare Tunnel, routed through Nginx Proxy Manager on Unraid; deadline 2026-09-29
**Date:** 2026-09-23
**Decision:** Testing is done; the app goes internet-reachable by Tuesday 2026-09-29, single-user auth only. Reinstates the Cloudflare Tunnel plan from the original 2026-09-19 authentication entry, but routed through Nginx Proxy Manager (already running on the Unraid server, `pill.1044nma.com`) rather than a bare tunnel-to-app connection: `Internet → Cloudflare Tunnel → NPM → PillPipe`. The production stack itself will also move from the Windows dev machine to the Unraid server (always-on; the tunnel and NPM already live there).
**Why:** The owner already runs a Cloudflare Tunnel container on Unraid for other services and NPM for TLS/host routing — reusing both is less new infrastructure than a bare nginx vhost, and NPM's per-host toggle between local-only and tunnel-routed access made it easy to test push notifications over HTTPS (required — Web Push is blocked on plain HTTP except localhost) before deciding to go public.
**Alternatives considered:** Plain nginx proxy without the tunnel (the 2026-09-19 plan, superseded above) — dropped once NPM was already in place and the tunnel was the lower-effort path to HTTPS for testing.
**Consequences:** Production serving, input validation, destructive-endpoint protection and secrets-at-rest (see `docs/TODO.md` Blockers) are no longer "paused" — they're due by the deadline. Deploying to Unraid needs its own compose project/ports that don't collide with the owner's other containers there. `trust proxy` hop count (currently 1 in `server/index.js`) needs re-checking against the real Tunnel→NPM→app path so `req.ip`-based rate limiting isn't spoofable via a forged `X-Forwarded-For` — verify during the production-serving work, don't assume.

## Web authentication: built-in single-user login, exposed via Cloudflare Tunnel
**Date:** 2026-09-19
**Decision:** The app enforces its own login (one password, scrypt hash in env, DB-backed session cookie, SameSite=Lax) and is exposed through a Cloudflare Tunnel. No identity proxy is relied on for access control.
**Why:** The app must be safe even if the proxy layer is misconfigured; a tunnel needs no open router ports and terminates HTTPS. Node's built-in scrypt avoids native dependencies; sessions live in the DB so logout and password changes revoke access. CSRF is handled with a required custom header (no CORS is enabled) rather than tokens.
**Alternatives considered:** Identity proxy only (Cloudflare Access / Tailscale Funnel) — least code but leaves the app unauthenticated behind it; JWT — can't be revoked; SameSite=Strict — would drop the cookie on the Google Drive OAuth redirect.
**Consequences:** `auth_sessions` intentionally has no foreign keys (restore truncates with CASCADE). Rate limits use `req.ip`, so the backend must only be reachable through the proxy. Cloudflare Access can still be added later as a second layer.

## No authentication layer (superseded 2026-09-19)
**Date:** 2024-01-01
**Decision:** No login, no user accounts. The app is kept off the public internet entirely.
**Why:** Auth adds significant complexity and the app is self-hosted for personal use. Tailscale provides private remote access without exposing the app publicly.
**Alternatives considered:** JWT-based auth — rejected as over-engineering for a single-user self-hosted tool.
**Consequences:** Cannot safely host on the public internet. Multi-user support is blocked until auth is added.

## Tailscale for remote access (superseded 2026-09-19 — may remain as an extra layer)
**Date:** 2024-01-01
**Decision:** Remote access is handled entirely by Tailscale VPN — no reverse proxy, no auth middleware.
**Why:** Zero config, zero maintenance, and no exposed ports. Keeps the threat surface minimal.
**Alternatives considered:** Nginx reverse proxy with basic auth — rejected as more maintenance for no real gain at this scale.
**Consequences:** Anyone on the Tailscale network has full app access. Acceptable for personal use.

## Indefinite phases stored as 9999 days with a boolean flag
**Date:** 2024-01-01
**Decision:** Indefinite phases store `duration_days = 9999` in the DB with `indefinite = true`. The calculator treats them as "fill the rest of the session."
**Why:** Avoids null handling throughout the calculator and keeps the data model simple.
**Alternatives considered:** NULL duration — rejected because it propagates null checks through every calculation path.
**Consequences:** 9999-day phases without the flag would be misread as indefinite. The flag is the source of truth.

## File watching via polling (Windows + Docker)
**Date:** 2024-01-01
**Decision:** Vite and nodemon both use polling (`usePolling: true`, 300–500ms) instead of inotify.
**Why:** inotify does not work reliably across the Windows/Docker boundary. Polling is the only reliable option.
**Alternatives considered:** inotify — does not work on Windows Docker volumes.
**Consequences:** Slightly higher CPU usage during development. Acceptable tradeoff.

## No automated tests (superseded 2026-09-19 — see docs/ARCHITECTURE.md Testing)
**Date:** 2024-01-01
**Decision:** No test suite. Manual verification via browser UI is the current practice.
**Why:** Project is early-stage and moving fast. Test infrastructure overhead is not justified yet.
**Alternatives considered:** Vitest + Playwright — deferred, not rejected.
**Consequences:** Regressions are caught manually. Acceptable while the user base is small.

## Startup migrations via ALTER TABLE IF NOT EXISTS
**Date:** 2024-01-01
**Decision:** Schema changes are applied at server boot using `ALTER TABLE IF NOT EXISTS` statements in `index.js`.
**Why:** Keeps migrations simple and avoids a migration framework. `db/init.sql` only runs on first container start (empty volume), so subsequent columns must be added via boot-time ALTER.
**Alternatives considered:** Flyway, Liquibase, custom migration runner — all rejected as over-engineering.
**Consequences:** Migration order matters. Destructive changes (DROP COLUMN) must be done manually.

## Opt-in ad model (Long-term — not yet implemented)
**Date:** 2024-01-01
**Decision:** If ads are ever added, ad-free is the default and users opt in to progressively more ads.
**Why:** Respects users. No paywalls. Ads are a passive support mechanism, not a monetization wall.
**Alternatives considered:** Freemium — rejected. "Pay to remove ads" — explicitly rejected as a dark pattern.
**Consequences:** Revenue potential is lower but user trust is preserved.

## "As Needed" dosing is UI-only, not a scheduling concept
**Date:** 2026-03-17
**Decision:** "As Needed" pills are flagged on the regimen card only — no slots, no notifications, no contribution to inventory math or shortfall calculations.
**Why:** Pills taken only when symptoms arise have no predictable schedule. Forcing them into the slot system would break the math and produce meaningless shortfall data.
**Alternatives considered:** Treating as a zero-dose phase — rejected as confusing. Separate dosing mode with its own math — rejected as over-engineering for a display-only concern.
**Consequences:** "As Needed" pills are visible in the regimen view but invisible to the calculator. Inventory for these pills must be managed manually.

## Meal-time dosing: no DB migration needed (web) — superseded on Android
**Date:** 2026-03-17
**Decision:** The web `daily_dose` → per-slot schema change requires no migration.
**Why:** The web app is not in production and there is no existing user data to preserve.
**Alternatives considered:** Writing a migration — unnecessary overhead given no live data.
**Consequences:** This assumption must be revisited before any public release. The Android app did ship a first-run migration (2026-03-24): when the new `dose_*` columns are first created, existing `dosage` values are copied into `dose_morning`.

## Meal-time dosing: fixed columns + JSON instead of a `dosing_slots` table
**Date:** 2026-03-24 (resolves the open question from 2026-03-17)
**Decision:** Android phases store `dose_morning`, `dose_lunch`, `dose_dinner`, `dose_custom` as columns, and arbitrary custom time+amount pairs as a JSON array in `phases.custom_slots`. Reminders live in a separate `regimen_notifications` table (type = morning/lunch/dinner/custom).
**Why:** The calculator only ever needs the sum of slot amounts, so no query needs to filter slots across regimens. Columns keep the sum trivial and avoid joins in SQLite.
**Alternatives considered:** Separate `dosing_slots` table (queryable, but joins for no benefit today).
**Consequences:** Slot-type queries across regimens need JSON parsing. `custom_time` (single) is legacy; `custom_slots` is authoritative. The web port should choose deliberately — the batched-push design may want the relational form.

## Web meal-time dosing: Android's columns, derived total, timezone-aware batched reminders
**Date:** 2026-09-19
**Decision:** Web phases store `dose_morning/dose_lunch/dose_dinner` (NUMERIC) and `custom_slots` (JSONB), the same names as Android. The daily total is always derived (`dailyDose`), never stored — there is no `dose_custom`. The web UI calls the first slot Breakfast (notation B L D) while storage and pref keys stay `morning*`. **As Needed** is a regimen-level, label-only flag (no phases, reminders, logging or shortfall/supply math). Reminders are batched per minute in the owner's timezone (`prefs.timezone`, auto-detected) from each regimen's active phase. Backups are version 2 (version 1 still restores; other versions are refused).
**Why:** Same shape keeps the two platforms easy to reconcile; deriving the total avoids the Android drift bug (`dose_custom` duplicating `custom_slots`). Containers run in UTC, so "8:00 AM" needs an explicit timezone. Refusing unknown backup versions stops a newer file from silently zeroing every dose on an older server.
**Alternatives considered:** A `dosing_slots`/`phase_doses` table (cleaner to query, more joins, diverges from Android); relying on the server `TZ` env only; per-regimen reminders (the old model).
**Consequences:** `dose_log` is one row per regimen per day, so a notification tap can only log regimens with a single dose that day (per-slot logging is a follow-up). Android does not yet have the two flags, and Android and web backups are still not interchangeable.

## Android app: offline-first with local SQLite
**Date:** 2024-01-01
**Decision:** The Android app uses local SQLite only — no backend server required.
**Why:** Mobile use case is primarily offline. Users should not need their home server running to check their supplements.
**Alternatives considered:** Proxy to self-hosted backend over Tailscale — rejected as requiring the server to always be reachable.
**Consequences:** Data is siloed on the device by default. Optional sync with the web backend is a future consideration.
