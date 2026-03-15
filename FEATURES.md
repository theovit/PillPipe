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
