# PillPipe — Feature Tracker

---

## Prioritized Backlog

### P1 — Build Next

#### Settings Menu
**Effort:** Medium | **Value:** High — home for all app-wide controls

A dedicated settings panel (⚙ in the header) that grows as features are added. The Data section is already built; future sections will live here too.

**Currently in settings**
- **Data — Download Backup** — exports all data to a dated JSON file
- **Data — Restore from Backup** — re-imports a backup JSON file (replaces all data, with confirmation)
- **Data — Clear All Data** — wipes the database with double confirmation

**Planned additions**
- **Appearance** — font size (small / medium / large), theme color picker
- **Preferences** — date format, default session duration
- **Notifications** — reminder times and snooze duration (once reminders are built)

---

#### Version Handling
**Effort:** Very Low | **Value:** Medium — good hygiene, enables About section

The running app should know and display its own version so users always know what build they're on. Foundation for the About section and future update notifications.

**Planned behavior**
- Server reads version from `package.json` at startup and logs it to stdout
- `GET /version` endpoint returns `{ "version": "1.0.0" }`
- Client fetches version on mount and displays it in the About section and/or footer
- Follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`)

---

### P2 — Near Term

#### Dose Reminders & Notifications
**Effort:** Medium | **Value:** High — closes the "when to take it" gap

Push notifications that remind you to take each supplement at the right time, based on your active session and dosing schedule. Currently the app tells you what to take and whether you'll run out — but it doesn't tell you *when* to take it. This closes that gap.

**Planned behavior**
- Per-regimen reminder times configurable in the regimen card (e.g. Magnesium at 9pm, LDN at 3am)
- Respects `days_of_week` — only fires on days the supplement is scheduled
- Skips automatically when a phase ends or a session expires
- Snooze and mark-as-taken actions directly from the notification

**Delivery options under consideration**

| Option | Pros | Cons |
|---|---|---|
| **Web Push (PWA)** | Works on mobile via browser, no app store | Requires HTTPS + service worker |
| **ntfy (self-hosted)** | Free, self-hostable, simple API | Requires extra Docker container |
| **Pushover** | Reliable, simple | $5 one-time fee per platform |
| **Telegram Bot** | Rich interaction, free | Requires Telegram account |

**Open questions**
- Should taken/skipped doses be logged for adherence tracking?
- Should reminders be server-driven (cron job) or client-driven (service worker)?

---

#### About Section
**Effort:** Very Low | **Value:** Low–Medium — polish and transparency

A simple modal accessible from the nav showing basic app info. Depends on version handling being built first so it can display the live version number.

**Planned content**
- App version (pulled from `GET /version`)
- Short description of what PillPipe does
- Link to the GitHub repo
- Open source license info
- Link to the Donate section

---

### P3 — Medium Term

#### Adherence Tracking
**Effort:** Medium | **Value:** High — depends on reminders

Log whether each dose was taken, skipped, or snoozed over time. Gives users and their doctors a real history of how well a protocol was followed. Depends on the dose reminder feature being built first since reminders are the natural trigger for logging.

**Planned behavior**
- Each reminder notification has "Taken" and "Skip" actions
- Dose events are stored in a new `dose_log` table (regimen_id, date, status)
- Adherence view per regimen: calendar or percentage breakdown
- Data included in session export / shortfall report

---

#### Shortfall Export
**Effort:** Low–Medium | **Value:** Medium — useful for doctor visits

Export the shortfall calculation results as a PDF or CSV so users can hand it to a doctor or use it when ordering supplements. Currently results only live in the UI.

**Planned behavior**
- "Export" button appears after Calculate is run
- PDF includes session dates, each regimen's phase summary, on-hand count, shortfall, bottles to buy, and cost
- CSV version for users who want to work with the data in a spreadsheet
- Grand total cost included in both formats

---

#### Session Templates
**Effort:** Medium | **Value:** Medium — power user feature

Save a session's regimen structure (supplements + phases) as a named template that can be reused when creating future sessions. Different from "Copy session" which copies to a specific new date — templates are generic and reusable indefinitely.

**Planned behavior**
- "Save as template" button on any session
- Templates listed when creating a new session ("Start from template")
- Templates store regimen + phase structure but not dates or on-hand counts
- Useful for recurring protocols that repeat every appointment cycle

---

### P4 — Later

#### Google SSO + Drive Backup
**Effort:** High | **Value:** Medium — convenience over local backup

Sign in with Google to enable automatic cloud backup of all data to Google Drive. Builds on the Data Backup foundation. OAuth2 adds auth infrastructure that could later support multi-user features.

**Planned behavior**
- OAuth2 login via Google — no separate PillPipe account needed
- Data exported as JSON and saved to a dedicated PillPipe folder in Drive
- Backup triggered manually or on a configurable schedule
- Restore from Drive after a data loss event or on a new device

**Open questions**
- Should Google login gate the whole app or just the backup feature?
- How often should auto-backup run — daily, on every change, or on demand only?

---

#### Flexible Ads
**Effort:** TBD | **Value:** TBD

*(Details to be provided — more scoping needed before this can be designed.)*

---

#### Donate Section
**Effort:** Very Low | **Value:** Low until app is public

A way for users to support the project. Low priority until the app has more users or is publicly available.

**Planned content**
- One-time donation via Ko-fi, Buy Me a Coffee, or GitHub Sponsors
- Optional recurring support
- Short note on what donations fund (hosting, development time, future features)

---

### P5 — Long Term

#### Authentication
**Effort:** High | **Value:** Required for public hosting

JWT-based login for multi-user or public hosting scenarios. Currently deferred — Tailscale handles private remote access securely without any auth layer. Only needed if the app is opened to the public internet or shared with multiple users.

---

#### Android App
**Effort:** Very High | **Value:** High — offline-first mobile experience

A native Android app with local SQLite storage — no server, no Docker, no internet required. Data lives entirely on the phone. The shortfall engine would be ported to run locally.

**Planned approach**
- React Native or Expo for cross-platform compatibility
- SQLite via `expo-sqlite` or `react-native-sqlite-storage`
- Offline-first: all reads/writes go to local DB
- Optional sync with the self-hosted backend for users who run both

---

#### Doctor Portal
**Effort:** Very High | **Value:** High — requires auth + multi-tenancy first

Multi-tenant support allowing healthcare providers to create sessions and push them to patients. Requires authentication and a full user/role model to be in place first.

---

## Completed

- [x] Per-regimen notes with auto-save
- [x] Collapse/expand regimen cards and sessions sidebar
- [x] Mobile touch-friendly UI (tap to edit, hidden icons, action buttons)
- [x] Indefinite phase support
- [x] Delete confirmations (sessions, regimens, supplements)
- [x] Block calculate when a regimen has no phases
- [x] Session date validation (target must be after start)
- [x] Copy session (clone regimens + phases to a new session)
- [x] Days-of-week dosing support
- [x] Grand total cost across all regimens
- [x] Quick inventory adjustment (+/− buttons on supplement rows)
- [x] Data backup & restore (JSON export/import via header modal)
