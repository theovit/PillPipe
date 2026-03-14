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
- **Phases** — ordered dosage steps (e.g. "2 pills/day for 2 weeks, then 1 pill/day until the appointment"). Supports day-of-week selection (Mon/Wed/Fri dosing) and duration in days or weeks.
- **Shortfall Engine** — calculates exactly how many pills you need, how many bottles to grab, and the total cost. Tracks current on-hand count as days pass.
- **Grand total cost** — see the total spend across all regimens after calculating.
- **Copy session** — clone a session's regimens and phases to a new session at your next appointment.
- **Notes** — attach notes to sessions (doctor instructions, reminders, etc.).
- **Supplements panel** — manage your supplement catalog with inventory, pricing, and type (maintenance vs. protocol).

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
| Frontend | React (Vite) + Tailwind CSS |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Infrastructure | Docker Compose |

---

## Project Structure

```
PillPipe/
├── client/                 # React frontend (Vite + Tailwind)
│   └── src/
│       ├── components/     # Dashboard, PhaseEditor, ShortfallAlert, SupplementsPanel
│       └── utils/          # API service layer
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

Edit `.env` and set a strong `DB_PASSWORD` before running.

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

- [ ] JWT authentication for multi-user or public hosting
- [ ] Android app — offline-first with local SQLite (no server required)
- [ ] Doctor portal — multi-tenant support for providers to push sessions to patients
