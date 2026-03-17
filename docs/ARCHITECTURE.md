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
| `client/src/Dashboard.jsx` | Top-level orchestrator. Manages sessions list, `openSessionIds[]`, Settings UI, supplements panel, and navigation shell. Renders one `<SessionPane>` per open session. |
| `client/src/SessionPane.jsx` | Self-contained per-session component. Owns all regimen-level state: regimens, phases, calc results, today's dose logs, reminder times, adherence. Handles its own data loading and SW push-notification dose-tap events. |
| `client/src/PhaseEditor.jsx` | Add, edit, reorder, delete phases for a regimen. |
| `client/src/ShortfallAlert.jsx` | Displays calculate results and export actions (CSV, PDF, shopping list). |
| `client/src/AdherenceCalendar.jsx` | 30-day dot grid showing taken/skipped/missed per regimen. |
| `client/src/SupplementsPanel.jsx` | Supplement inventory management view. |

## Backend Structure

All routes live in `server/index.js`. No separate route files.

Startup migrations run on boot via `ALTER TABLE IF NOT EXISTS` — this is how new columns are added
without wiping data. `db/init.sql` only runs on the very first container start (empty volume).

| File | Role |
|---|---|
| `server/index.js` | All Express routes + startup migrations + cron jobs |
| `server/calculator.js` | Shortfall engine — the core business logic |
| `server/db.js` | PostgreSQL connection pool |

## Data Model

```
supplements
  id (UUID PK)
  name, brand, form, unit, drops_per_ml, serving_size
  on_hand, reorder_threshold
  price_per_bottle, pills_per_bottle

sessions
  id (UUID PK)
  name, start_date, target_date

regimens
  id (UUID PK)
  session_id (FK → sessions, CASCADE DELETE)
  supplement_id (FK → supplements)
  notes, reminder_time

phases
  id (UUID PK)
  regimen_id (FK → regimens, CASCADE DELETE)
  duration_days, indefinite (bool)
  pills_per_day, days_of_week (INTEGER[])
  start_offset_days

dose_log
  id (UUID PK)
  regimen_id (FK → regimens)
  log_date, status (taken/skipped)

push_subscriptions
  id (UUID PK)
  endpoint, keys (JSON)

session_templates
  id (UUID PK)
  name, data (JSON snapshot of session + regimens + phases)

settings
  key, value (key-value store for server-synced prefs)
```

Deleting a session cascades to its regimens and phases.

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
| Dose reminder | Every minute | Checks `reminder_time` per regimen; sends Web Push if due |
| Running low | Daily 8am | Checks `reorder_threshold` per supplement; sends push notification |
| Google Drive backup | Configurable | Uploads JSON backup on schedule or on data change |

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
  → checks regimens with reminder_time = now
  → fetches push_subscriptions
  → sends Web Push via VAPID
  → Service Worker receives notification
  → User taps → SW posts message to client
  → SessionPane logs dose via POST /dose-log
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
| Tailscale | Private remote access — no auth layer needed |
