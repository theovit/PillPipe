# PillPipe

> Self-hosted supplement inventory and protocol management — built for complex, multi-phase regimens where every pill counts.

---

## The Problem

Standard pill trackers tell you what to take. They don't tell you if you'll run out before your next appointment.

When a protocol involves tapering doses across weeks — and each bottle costs $50+ — you need to know:

- **Will I have enough?** Exactly how many pills do I need between now and my next evaluation?
- **Should I reorder?** If I'm 2 pills short but have to buy a 60-count bottle, is it worth it?

PillPipe answers both questions.

---

## Features

- **Sessions** — define a treatment window (start → next appointment). See days remaining or days overdue at a glance.
- **Regimens** — attach supplements to a session and define their dosing schedule.
- **Phases** — ordered dosage steps (e.g. "2 pills/day for 2 weeks, then 1 pill/day until the appointment"). Supports day-of-week selection (Mon/Wed/Fri dosing), duration in days or weeks, and an **Indefinite** flag for long-term maintenance supplements that fills the rest of the session automatically.
- **Shortfall Engine** — calculates exactly how many pills you need, how many bottles to grab, and the total cost. Tracks current on-hand count as days pass.
- **Grand total cost** — see the total spend across all regimens after calculating.
- **Quick inventory adjustment** — +/− buttons on supplement rows for fast on-hand count updates without leaving the panel.
- **Copy session** — clone a session's regimens and phases to a new session at your next appointment.
- **Per-regimen notes** — attach notes directly to a regimen with auto-save (doctor instructions, timing reminders, etc.).
- **Session notes** — attach notes to sessions for top-level context.
- **Collapse/expand** — regimen cards and the sessions sidebar can be collapsed to reduce visual clutter.
- **Supplements panel** — manage your supplement catalog with inventory, pricing, and type (maintenance vs. protocol).
- **Mobile touch-friendly UI** — tap to edit, hidden icons, action buttons optimized for phone use.
- **Settings page** — full-screen tab with data backup, restore, and clear; version info; and appearance/preference placeholders.
- **Data backup & restore** — export all your data as JSON and restore it later from Settings → Data.
- **Version display** — app version shown in the Settings footer, pulled live from the server.

---

## How It Works: The Shortfall Engine

PillPipe models your entire regimen as a series of **phases** tied to a **Target Date** (your next appointment). Given your current inventory, it calculates:

| Status | Meaning |
|---|---|
| **Covered** | You have enough pills to reach the Target Date |
| **Shortfall** | You will run out before the Target Date — grab N bottles |
| **Waste Warning** | You need N pills but must buy a full bottle — flags cost vs. utility |

The engine also accounts for **days already elapsed** — the on-hand count decrements as the session progresses so your inventory stays accurate in real time.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 (Vite) + Tailwind CSS v4 |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Infrastructure | Docker Compose |

---

## Project Structure

```
PillPipe/
├── client/                 # React frontend (Vite + Tailwind)
│   └── src/
│       ├── App.jsx         # Root component and routing
│       ├── main.jsx        # Entry point
│       ├── components/     # Dashboard, PhaseEditor, ShortfallAlert, SupplementsPanel
│       └── utils/          # API service layer (api.js)
├── server/                 # Node.js + Express backend
│   ├── index.js            # Routes & middleware
│   ├── calculator.js       # Shortfall Engine logic
│   └── db.js               # PostgreSQL connection
├── db/
│   └── init.sql            # Schema & seed data
├── .env.example            # Environment variable template
├── docker-compose.yml
└── README.md
```

---

## Getting Started

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set a strong `DB_PASSWORD` before running. The template ships with:

```
DB_USER=pillpipe
DB_PASSWORD=changeme
DB_NAME=pillpipe
```

### 2. Start the stack

```bash
docker compose up --build
```

The schema in `db/init.sql` runs automatically on first startup.

| Service | URL |
|---|---|
| Web UI | http://localhost:5173 |

---

## Remote Access via Tailscale

Tailscale lets you access PillPipe from your phone or any device without exposing it to the public internet.

### Setup

1. Install [Tailscale](https://tailscale.com/download) on the machine running Docker and on your phone.
2. Sign in on both devices — they'll appear on the same private network automatically.
3. Find your machine's Tailscale IP in the Tailscale admin console (e.g. `100.x.x.x`).
4. Open `http://100.x.x.x:5173` on your phone.

That's it. No port forwarding, no DNS, no certificates required. Only devices on your Tailscale network can reach the app.

> **Note:** The backend (port 3000) and database (port 5432) are not exposed outside Docker — only the Vite frontend on port 5173 is reachable.

---

## Database Schema

**supplements** — the pills themselves

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | Text | |
| brand | Text | |
| pills_per_bottle | Integer | |
| price | Decimal | |
| type | Enum | `maintenance` or `protocol` |
| current_inventory | Integer | Current pill count on hand |

**sessions** — a treatment window

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| start_date | Date | |
| target_date | Date | Next appointment |
| notes | Text | Optional doctor instructions / reminders |

**regimens** — a supplement within a session

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| session_id | UUID | FK → sessions |
| supplement_id | UUID | FK → supplements |

**phases** — ordered dosage steps within a regimen

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| regimen_id | UUID | FK → regimens |
| dosage | Integer | Pills per dose |
| duration_days | Integer | Length of this phase |
| days_of_week | Integer[] | Null = every day; 0=Sun … 6=Sat |
| indefinite | Boolean | Fills remaining session days automatically |
| sequence_order | Integer | 1, 2, 3… |

---

## Privacy & Security

PillPipe is fully self-hosted. Your data never leaves your own machine.

- Backend API is internal to Docker — not exposed on the host
- Database is internal to Docker — not exposed on the host
- Credentials are stored in `.env` (gitignored)
- Error responses never leak internal details

---

## Roadmap

### Near Term
- [ ] **Dose reminders & notifications** — push alerts at the right time, per regimen, respecting days-of-week schedules
- [ ] **About modal** — app version, description, GitHub link, and license info accessible from the nav
- [ ] **Shortfall export** — download calculation results as PDF or CSV for doctor visits

### Medium Term
- [ ] **Adherence tracking** — log taken/skipped/snoozed doses; calendar and percentage views per regimen
- [ ] **Session templates** — save a regimen structure as a reusable template for recurring protocols

### Later
- [ ] **Google SSO + Drive backup** — sign in with Google; auto-backup data to Drive on a configurable schedule
- [ ] **JWT authentication** — multi-user or public hosting support
- [ ] **Android app** — offline-first with local SQLite; shortfall engine runs entirely on-device
- [ ] **Doctor portal** — multi-tenant support for providers to push sessions to patients

---

## WIP: Dose Reminders & Notifications

> **Status:** Planned — not yet implemented.

The goal is push notifications that remind you to take each supplement at the right time, based on your active session and dosing schedule.

### Planned behavior

- Per-regimen reminder times (e.g. Magnesium at 9pm, LDN at 3am)
- Respects `days_of_week` — only fires on scheduled days
- Skips automatically when a phase ends or a session expires
- Snooze and mark-as-taken actions from the notification

### Delivery options under consideration

| Option | Pros | Cons |
|---|---|---|
| **Web Push (PWA)** | Works on mobile via browser, no app store | Requires HTTPS + service worker |
| **ntfy (self-hosted)** | Free, self-hostable, simple API | Requires extra Docker container |
| **Pushover** | Reliable, dead simple | $5 one-time fee per platform |
| **Telegram Bot** | Rich interaction, free | Requires Telegram account |

### Open questions

- Should taken/skipped doses be logged for adherence tracking?
- Should reminders be server-driven (cron job) or client-driven (service worker)?
