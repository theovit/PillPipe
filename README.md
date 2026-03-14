# PillPipe

PillPipe is a high-precision supplement inventory and protocol management web app. It is designed specifically for users on complex, multi-phase regimens where supplements are expensive and waste must be minimized.

## The Core Problem

Many specialized supplements cost $50+ per bottle. When a protocol involves tapering doses (e.g., "take 3 for 2 weeks, then 1 for 5 weeks"), standard pill trackers fail to predict exactly when you will run out. PillPipe calculates the exact pill-count gap between your current inventory and your next doctor's evaluation.

## Key Logic: The Shortfall Engine

Unlike regular trackers, PillPipe calculates supply based on a **Target Date** (your next appointment).

- **Covered:** You have enough pills to reach the Target Date.
- **Shortfall:** You will run out X days before the Target Date.
- **Waste Warning:** If you need 2 extra pills to finish a protocol, but must buy a 60-count bottle for $50, the app flags the cost vs. utility so you can decide whether to purchase or adjust the protocol.

## Tech Stack

- **Frontend:** React (Vite) + Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Orchestration:** Docker Compose

## Project Structure

```
pill-pipe/
├── client/                 # React Frontend (Vite + Tailwind)
│   └── src/
│       ├── components/     # Dashboard, Phase Editor, ShortfallAlert
│       └── utils/          # API services
├── server/                 # Node.js Backend
│   ├── index.js            # Express Routes & Middleware
│   ├── calculator.js       # The Shortfall Engine Logic
│   └── db.js               # Postgres Connection (using pg)
├── db/
│   └── init.sql            # Database Schema & Initial Seeds
├── README.md
└── docker-compose.yml      # Docker Configuration for App + DB
```

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### Installation

1. **Start the environment:**
   ```bash
   docker-compose up --build
   ```

2. **Database migration:**
   The `init.sql` script in `/db` runs automatically on first startup to create all tables.

3. **Access:**
   - Web UI: http://localhost:5173
   - API: http://localhost:3000

## Database Schema

### supplements
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary Key |
| name | String | |
| brand | String | |
| pills_per_bottle | Integer | |
| price | Decimal | |
| type | Enum | `maintenance` or `protocol` |

### sessions
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary Key |
| start_date | Date | |
| target_date | Date | The "finish line" or appointment date |

### regimens
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary Key |
| session_id | UUID | FK to sessions |
| supplement_id | UUID | FK to supplements |
| current_inventory | Integer | Physical count at session start |

### phases
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary Key |
| regimen_id | UUID | FK to regimens |
| dosage | Integer | Pills per day |
| duration_days | Integer | |
| sequence_order | Integer | Phase 1, Phase 2, etc. |

## Security & Privacy

- **Self-Hosted:** You own your data. Run this on a home server, Raspberry Pi, or private VPS.
- **No External APIs:** Your medical regimen never leaves your private network.

## Roadmap

- [ ] PWA Support: "Add to Home Screen" support for iOS/Android
- [ ] Cost Projection: See the total cost of your next refill trip
- [ ] Doctor Portal: Multi-tenant support allowing doctors to push sessions directly to patients
