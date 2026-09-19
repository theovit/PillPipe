# Architecture

## Overview

PillPipe is a self-hosted supplement inventory and shortfall calculator. The web app runs as three
Docker services. An Android app (in development) runs offline-first with local SQLite — no server required.

## Components

### Web App

```
Browser → Vite dev server (:5173) → proxy /api/* → Express (:3000) → PostgreSQL (:5432)
```

| Component | Tech | Responsibility |
|---|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4 | Single-page app; all UI |
| Backend | Node.js, Express | REST API; business logic; cron jobs |
| Database | PostgreSQL 13 | Persistent storage |

### Android App (`app/`)

```
Expo / React Native → expo-sqlite (local) → SQLite on device
```

Offline-first. No backend server required. Data lives on the device.
Optional future sync with the web backend is not yet implemented.

## Frontend Structure

Single-page app with no router. Three views — "Regimens", "Supplements", "Settings" — toggled by
local state in `Dashboard.jsx`.

### Key Components

| File | Role |
|---|---|
| `client/src/components/AuthGate.jsx`, `Login.jsx` | Wraps `<Dashboard>` in `App.jsx`. Checks `GET /auth/me`, shows the sign-in form, and flips back to it when any API call returns 401 (`onUnauthorized` in `api.js`). A network/server error shows Retry rather than the login form. |
| `client/src/components/Dashboard.jsx` | Top-level orchestrator. Manages sessions list, `openSessionIds[]`, Settings UI, supplements panel, and navigation shell. Renders one `<SessionPane>` per open session. |
| `client/src/components/SessionPane.jsx` | Self-contained per-session component. Owns all regimen-level state: regimens, phases, calc results, today's dose logs, reminder times, adherence. Handles its own data loading and SW push-notification dose-tap events. |
| `client/src/components/PhaseEditor.jsx` | Add, edit, reorder, delete phases for a regimen. |
| `client/src/components/ShortfallAlert.jsx` | Displays calculate results and export actions (CSV, PDF, shopping list). |
| `client/src/components/AdherenceCalendar.jsx` | 30-day dot grid showing taken/skipped/missed per regimen. |
| `client/src/components/SupplementsPanel.jsx` | Supplement inventory management view, including the add/edit supplement form. |
| `client/src/utils/dosing.js` | Shared dose helpers: `dailyDose`, `phaseNotation` (`B1 L1 D2 +1@2:30 PM`), `activePhase`, `todayInTz` |
| `client/src/utils/api.js`, `prefs.js` | API client; appearance/preference storage (localStorage + server-synced). |

## Backend Structure

All routes live in `server/index.js`. No separate route files.

Startup migrations run on boot via `ALTER TABLE IF NOT EXISTS` — this is how new columns are added
without wiping data. `db/init.sql` only runs on the very first container start (empty volume).

| File | Role |
|---|---|
| `server/index.js` | All Express routes + startup migrations + cron jobs |
| `server/calculator.js` | Shortfall engine — the core business logic |
| `server/db.js` | PostgreSQL connection pool |
| `server/dosing.js` | Dose math (`dailyDose`), phase validation, `activePhase` (half-open session window), `supplementDaysRemaining` — client twin: `client/src/utils/dosing.js` |
| `server/notifications.js` | Pure reminder logic: `dueNotifications`, `buildPayload` (4 KB guard), `sendBatch`, minute deduper |
| `server/backup.js` | Backup export/restore shared by `/backup`, `/restore` and Google Drive. Version 2; version 1 (flat `dosage`) still restores; other versions are refused |
| `server/tz.js` | `nowInTz` — the wall clock in `prefs.timezone` (containers run UTC) |
| `server/auth.js`, `password.js` | Single-user login (see below) |

### Authentication and request pipeline (`server/auth.js`)

Single-user password login; no accounts. Middleware order in `server/index.js` matters:
`apiLimiter` (flood limit) → `csrf` → `gate` (session required unless allowlisted) → `auth.router` (`/auth/login|me|logout|logout-all`) → JSON body parser → Drive on-change hook → routes.

- **Allowlist** (`OPEN` in `auth.js`): only `GET|HEAD /health`, `POST /auth/login`, `GET /auth/me`. Everything else, including unknown paths, is 401.
- **Password**: `APP_PASSWORD_HASH` = `scrypt:N:r:p:salt:hash` (colon format because Compose mangles `$`); see `server/password.js`. Changing it invalidates all sessions.
- **Sessions**: `auth_sessions` table (SHA-256 of a random 32-byte token; no foreign keys so a restore's `TRUNCATE ... CASCADE` can't touch it). Cookie `pp_session` (`__Host-pp_session` when `COOKIE_SECURE`), HttpOnly, SameSite=Lax (Strict would drop it on the Google OAuth redirect). Idle + absolute expiry.
- **CSRF**: every non-GET needs `X-Requested-With: pillpipe`; `Sec-Fetch-Site` must be same-origin/none; `Origin` must equal `APP_ORIGIN` when set.
- **Google OAuth**: `state` (hash stored on the session row, single use) is verified in the callback before any token exchange.
- **Proxy**: `trust proxy` = 1 hop, so rate limits key on the real client IP only when the backend is reachable solely through the reverse proxy.

## Data Model

Web (PostgreSQL). Columns marked † are added by boot-time `ALTER TABLE` in `server/index.js`, not `db/init.sql`.

```
supplements
  id (UUID PK)
  name, brand, type (maintenance/protocol)
  pills_per_bottle (NUMERIC†), price (NUMERIC(10,2)), current_inventory (NUMERIC†)
  unit† (capsules/tablets/ml/drops), drops_per_ml† (default 20)
  reorder_threshold†, reorder_threshold_mode† (units/days), take_with_food† (BOOLEAN)
  (for ml/drops, pills_per_bottle holds ml per bottle)

sessions
  id (UUID PK)
  start_date, target_date, notes†

regimens
  id (UUID PK)
  session_id (FK → sessions, CASCADE DELETE)
  supplement_id (FK → supplements, CASCADE DELETE)
  notes†, as_needed† (BOOLEAN — label only: no phases/reminders/logging/shortfall math), reminder_time† (legacy, unused)

phases
  id (UUID PK)
  regimen_id (FK → regimens, CASCADE DELETE)
  dose_morning / dose_lunch / dose_dinner (NUMERIC†) and custom_slots (JSONB† [{amount, time "HH:MM"}]) —
    the daily dose is their SUM, always derived (no stored total); dosage† is legacy (0 after the boot migration)
  duration_days, indefinite (bool), days_of_week (INTEGER[], NULL = every day)
  sequence_order (UNIQUE per regimen)

dose_log
  id (UUID PK)
  regimen_id (FK → regimens, CASCADE DELETE)
  date, status (taken/skipped), logged_at — UNIQUE (regimen_id, date)

push_subscriptions
  id (UUID PK)
  endpoint (UNIQUE), p256dh, auth

templates → template_regimens → template_phases
  session templates as relational copies of regimens + phases (same dosing columns, as_needed) (created at boot)

google_tokens, google_drive_settings (singleton), user_settings (singleton, prefs JSONB)
  Drive OAuth tokens, backup frequency/state, server-synced prefs
```

Deleting a session cascades to its regimens and phases.

### Android (SQLite, `app/src/db/database.ts`)

Same shape with TEXT ids and REAL numbers, plus:
- `phases.dose_morning / dose_lunch / dose_dinner / dose_custom` (REAL) and `custom_slots` (JSON `[{amount,time}]`); legacy `custom_time`. The calculator sums the four dose columns.
- `regimen_notifications (regimen_id, type, custom_time)` — one row per reminder slot; scheduled locally via `expo-notifications`.
- `session_templates (id, name, data JSON)` — single-table snapshot, unlike the web's three template tables.
- Meal-time defaults, font size, date format, default duration live in AsyncStorage (`app/src/utils/prefs.ts`), not the DB.

## Shortfall Engine (`server/calculator.js`)

Called via `GET /sessions/:sessionId/calculate`.

1. Fetch all regimens + phases for the session
2. For each phase, count actual dosing days (respecting `days_of_week` and `indefinite` flag)
3. Compute pills consumed since session start (calendar-elapsed days × dosing days ratio)
4. Subtract from current on-hand inventory → real-time on-hand
5. Calculate shortfall, bottles to buy, waste, cost, and days of coverage

**Indefinite phases** are stored as `duration_days = 9999` with `indefinite = true`. The engine
treats them as "fill the remainder of the session." See `docs/DECISIONS.md`.

## Cron Jobs (server-side)

| Job | Schedule | Purpose |
|---|---|---|
| Dose reminders | Every minute | Batched per time slot: regimens whose active phase has a dose at this minute (in the owner's timezone) → ONE Web Push listing them. Also re-checks the previous minute; a minute deduper prevents repeats |
| Running low | Daily 8am | Checks `reorder_threshold` per supplement; sends push notification |
| Google Drive backup | Configurable | Uploads JSON backup on schedule or on data change |
| Session purge | Daily 3am | Deletes expired `auth_sessions` rows |

## Data Flow — Calculate

```
User clicks Calculate
  → GET /sessions/:id/calculate
  → calculator.js fetches regimens + phases
  → calculates per-regimen results
  → returns JSON
  → ShortfallAlert renders results
  → CSV / PDF / Shopping List export available client-side
```

## Data Flow — Dose Reminder Push

```
Server cron (every minute)
  → owner's timezone from prefs (falls back to server TZ / UTC) → local date + HH:MM
  → for each regimen: active phase today? dosing day? a dose at this minute (meal times from prefs, or a custom slot)?
  → dueNotifications() merges everything due into ONE batch (as-needed regimens are never included)
  → sendBatch(): one Web Push per subscription; 404/410 subscriptions are removed
  → Service Worker shows it; Taken/Skip buttons only if some listed regimen has a single dose today
  → tap → the SW POSTs /api/dose-log itself (session cookie + CSRF header), then tells open panes to refresh
```

## Key Design Patterns

- **Self-contained panes** — each `SessionPane` manages its own API calls and state independently.
  Dashboard is unaware of regimen-level data.
- **Boot-time migrations** — no migration framework; `ALTER TABLE IF NOT EXISTS` at server start.
- **Client-side exports** — CSV, PDF, and shopping list are generated entirely in the browser.
  No server involvement after calculate.
- **Server-synced prefs** — appearance and preferences are stored in both localStorage (fast reads)
  and `GET/PUT /settings/prefs` (included in backups).

## File Watching (Windows + Docker)

Vite and nodemon use polling because inotify does not work reliably across the Windows/Docker
boundary. See `vite.config.js` and `server/nodemon.json`. See also `docs/MEMORY.md`.

## External Dependencies

| Service | Purpose |
|---|---|
| Google Drive (OAuth2) | Optional cloud backup |
| Web Push / VAPID | Dose reminders and low-stock alerts |
| Tailscale | Current private remote access. **Planned:** internet exposure with authentication + hardening — see `docs/DECISIONS.md` (2026-09-19) and Blockers in `docs/TODO.md`. The app has no auth today. |

## Testing

- `cd server && npm run test:unit` — 58 pure tests, no database: dose math, calculator, timezones, reminders, the service worker (loaded into a Node `vm` sandbox) and a client/server "twin" check.
- `npm test` — everything including the API/auth black-box tests. Those need the throwaway stack (`docker-compose.test.yml`, see `docs/MEMORY.md`) because they wipe data on purpose.
- The client has no test runner; UI changes are verified in a browser (`npm run lint` + `npm run build` for static checks).
