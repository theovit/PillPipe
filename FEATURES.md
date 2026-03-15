# PillPipe — Feature Tracker

## WIP (In Progress)

### Dose Reminders & Notifications
**Status:** Planned — not yet implemented

Per-regimen push notifications reminding you to take each supplement at the right time.

**Planned behavior**
- Per-regimen reminder times (e.g. Magnesium at 9pm, LDN at 3am)
- Respects `days_of_week` — only fires on scheduled days
- Skips automatically when a phase ends or a session expires
- Snooze and mark-as-taken actions from the notification

**Delivery options under consideration**

| Option | Pros | Cons |
|---|---|---|
| **Web Push (PWA)** | Works on mobile via browser, no app store | Requires HTTPS + service worker |
| **Pushover / ntfy** | Dead simple, self-hostable (ntfy) | Requires third-party account or extra container |
| **Telegram Bot** | Rich interaction, free | Requires Telegram account |

**Open questions**
- Should taken/skipped doses be logged for adherence tracking?
- Should reminders be server-driven (cron job) or client-driven (service worker)?

---

## Future Features

### Version Handling
Track and expose the running application version so users and operators always know what build is deployed.

**Behavior**
- Server exposes a `GET /version` endpoint returning the current app version from `package.json`
- Client displays the version in the About section (and footer or settings menu)
- On startup, the server logs the running version to stdout
- Version follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`)

**Implementation notes**
- Read version at startup from `server/package.json` (e.g. `const { version } = require('./package.json')`)
- `GET /version` response: `{ "version": "1.0.0" }`
- Client fetches version on mount and stores it in component state; displayed as "v1.0.0" in the UI
- No authentication required — version endpoint is public

**Open questions**
- Should the client show a "new version available" banner when a newer release is detected (requires a release feed or remote manifest)?
- Should version be included in the `GET /health` response as well?

---


### Quick Inventory Adjustment
Allow users to bump the on-hand count up or down directly from the supplements list without opening the full edit form.

**Behavior**
- `+` and `−` buttons on each supplement row (or in the expanded mobile view)
- Each tap adjusts `current_inventory` by 1 and saves immediately
- Count cannot go below 0
- Useful for small corrections — dropped a pill, lost one, took an extra without marking a full dose

**UI sketch**
```
[ Magnesium Glycinate ]   120 on hand  [ − ] [ + ]   maintenance
```

**Implementation notes**
- `PATCH /supplements/:id` with `{ current_inventory }` body
- Optimistic UI update — change local state immediately, revert on error
- Prompt user to recalculate if a session result is already displayed

---

### Authentication
- JWT-based login for multi-user or public hosting
- Currently deferred — Tailscale handles private remote access

### Android App
- Offline-first with local SQLite (no server required)
- See memory file for planned approach

### Doctor Portal
- Multi-tenant support for providers to push sessions to patients

### Adherence Tracking
- Log taken/skipped doses over time
- View adherence history per regimen
- Depends on dose reminder feature being built first

### Inventory Auto-Decrement
- Button or workflow to mark a dose as taken and decrement on-hand count
- Currently inventory is managed manually via the Supplements panel

### Session Templates
- Save a session's regimen structure as a reusable template
- Distinct from "Copy session" (which copies to a specific new date)

### Shortfall Export
- Export the calculate results as PDF or CSV
- Useful for sharing with a doctor or ordering assistant

---

### Data Backup
Manual and automatic backup of all user data so nothing is lost if the Docker volume is wiped.

**Options under consideration**
- Manual export: download a `.sql` or `.json` snapshot from the UI
- Auto-backup: scheduled `pg_dump` to a local file on a configurable interval
- Restore: upload a backup file to reinitialize the database

---

### Google SSO + Drive Backup
Sign in with Google to enable automatic backup of data to Google Drive.

**Behavior**
- OAuth2 login via Google — no separate account needed
- Data exported as JSON and saved to a dedicated PillPipe folder in Drive
- Backup triggered manually or on a schedule
- Restore from Drive on first login or after a data loss event

**Open questions**
- Should Google login gate the whole app or just the backup feature?
- How often should auto-backup run (daily, on every change)?

---

### Settings Menu
A dedicated settings panel accessible from the main nav for app-wide preferences.

**Planned settings**
- **Font size** — small / medium / large
- **Theme color picker** — change the violet accent to a user-chosen color
- **Date format** — MM/DD/YYYY vs DD/MM/YYYY vs YYYY-MM-DD
- **Default session duration** — pre-fill the target date offset when creating a new session
- Other relevant preferences as features are added

---

### About Section
A simple modal or page with app info.

**Planned content**
- App version
- Short description and purpose
- Link to GitHub repo
- Credits / open source licenses

---

### Donate Section
A way for users to support the project financially.

**Planned content**
- One-time donation via Ko-fi, Buy Me a Coffee, or GitHub Sponsors
- Optional recurring support
- Short note on what donations fund (hosting, development time, etc.)

---

### Flexible Ads
*(Details to be provided later)*

**Status:** Placeholder — more detail needed before scoping.

---

## Completed (recent)

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
