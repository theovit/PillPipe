# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development (Docker Compose — primary workflow)
```bash
docker compose up --build    # First run or after dependency changes
docker compose up            # Normal start (frontend :5173, backend :3000)
docker compose down          # Stop services
```

### Client (run inside container or with local Node)
```bash
cd client && npm run dev     # Vite dev server on :5173
cd client && npm run build   # Production build
cd client && npm run lint    # ESLint
```

### Server
```bash
cd server && npm run dev     # nodemon (auto-reload)
cd server && npm start       # production
```

There are no automated tests. Manual verification via the browser UI is the current practice.

## Architecture

PillPipe is a self-hosted supplement inventory and shortfall calculator. Three Docker services communicate via internal Docker DNS:

```
Browser → Vite (:5173) → proxy /api/* → Express (:3000) → PostgreSQL (:5432)
```

- **Frontend** (`client/`): React 19 + Vite + Tailwind CSS 4. Single-page app. No router; three views ("Regimens", "Supplements", "Settings") toggled by local state in `Dashboard.jsx`.
  - **`Dashboard.jsx`** — top-level orchestrator: manages the sessions list, `openSessionIds[]` (which sessions are currently expanded), all Settings UI, and the supplements/navigation shell. Renders one `<SessionPane>` per open session.
  - **`SessionPane.jsx`** — self-contained per-session component. Owns all regimen-level state: regimens, phases, calc results, today's dose logs, reminder times, adherence. Receives `session`, `supplements`, `prefs`, `notifStatus`, and `onClose` as props. Handles its own data loading and SW push-notification dose-tap events.
  - Other components: `PhaseEditor`, `ShortfallAlert`, `AdherenceCalendar`, `SupplementsPanel`.
- **Backend** (`server/`): Express REST API. `index.js` contains all routes. Startup migrations (ALTER TABLE IF NOT EXISTS) run on boot to add columns without wiping data.
- **Database** (`db/init.sql`): PostgreSQL 13. Four tables: `supplements`, `sessions`, `regimens`, `phases`. UUID PKs, cascading deletes. `init.sql` only runs on first container start (when the volume is empty).

### Shortfall Engine (`server/calculator.js`)

The core business logic. Called via `GET /sessions/:sessionId/calculate`. It:
1. Fetches all regimens + phases for a session
2. For each phase, counts actual dosing days (respecting `days_of_week` INTEGER[] and `indefinite` flag)
3. Computes pills consumed since session start (calendar-elapsed days × dosing days ratio)
4. Subtracts from current on-hand inventory to get real-time on-hand
5. Calculates shortfall, bottles to buy, waste, cost, and days of coverage

**Indefinite phases** are stored as 9999 days in the DB with `indefinite = true`; the engine treats them as "fill the rest of the session."

### Key data relationships
```
sessions → regimens (FK session_id) → phases (FK regimen_id)
supplements ← regimens (FK supplement_id)
```

Deleting a session cascades to its regimens and phases.

### File watching (Windows + Docker)
Vite and nodemon are both configured for polling (`usePolling: true`, 300–500 ms intervals) because inotify doesn't work reliably on Windows Docker. See `vite.config.js` and `server/nodemon.json`.

## Environment

Copy `.env.example` to `.env` before first run. Key vars:
- `DB_USER`, `DB_PASSWORD`, `DB_NAME` — PostgreSQL credentials
- `DATABASE_URL` — constructed from the above; used by `server/db.js`

The frontend proxies `/api/*` to `http://backend:3000` (Docker internal DNS). Direct backend port is not exposed to the host.

Remote access is via **Tailscale** — no auth layer is implemented; the app is kept off the public internet.
