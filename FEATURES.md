# PillPipe — Feature Tracker

---

## Prioritized Backlog

### P1 — Build Next

*All P1 items complete. See Completed section below.*

---

#### Liquid & Drops Support (archived)
**Effort:** Medium | **Value:** High — expands supplement types beyond capsules/tablets

Add first-class support for liquid supplements and tinctures dosed in milliliters, and for drop-based supplements (e.g. iodine, vitamin D liquid, LDN compounded drops). The two unit types are related — drops are converted to milliliters using a standard average of **20 drops per milliliter**, which is the accepted pharmacological convention for a standard dropper tip.

**Planned behavior**
- New `unit` field on each supplement: `capsules` (default), `tablets`, `ml`, `drops`
- When unit is `ml`: dose entry accepts decimal values (e.g. 1.5 ml), on-hand count tracked in ml
- When unit is `drops`: dose entry accepts whole drop counts; displayed alongside ml equivalent (e.g. "10 drops ≈ 0.5 ml") using the 20 drops/ml conversion
- Shortfall engine treats ml and drops as the same inventory pool for a given supplement — no separate tracking needed
- UI label on regimen rows and supplement panel updates dynamically to reflect unit type (e.g. "2 drops/day" instead of "2 caps/day")
- Cost-per-unit and bottles-to-buy logic adapted for volume-based units (e.g. per-ml cost, bottle size in ml)

**Conversion reference**
- 1 ml = 20 drops (standard dropper tip average)
- Display both values in the UI wherever drops are used so users always have the ml context

**Open questions**
- Should bottle size be entered in ml or in total drop count for drop-based supplements?
- Should the 20 drops/ml ratio be user-overridable per supplement for non-standard dropper tips?

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

**Decisions made**
- Delivery: Web Push (PWA) for now; Android push notifications will replace it when the mobile app ships
- Dose logging: Yes — taken/skipped doses will be logged (feeds into P3 Adherence Tracking)
- Scheduling: Server-driven cron job (more reliable than service worker)
- Settings: Notification preferences will live in the Settings page

---

### P3 — Medium Term

*Shortfall Export and Adherence Tracking complete. See Completed section.*

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
- [x] Data backup, restore, and clear (Settings → Data section)
- [x] Settings page — full-screen tab with collapsible sections; SVG cog icon in nav; Appearance + Preferences placeholders ready
- [x] Version handling — `GET /version` endpoint; version read from `package.json`; displayed in Settings footer
- [x] About section — collapsible Settings section; pill icon, version, description, GitHub link, MIT license
- [x] Liquid & Drops support — `unit` field (capsules/tablets/ml/drops), `drops_per_ml` override, dynamic labels throughout UI, decimal dosage/inventory for ml, drops↔ml conversion in calculator route
- [x] Dose Reminders & Notifications — Web Push (VAPID), service worker, subscribe/unsubscribe in Settings, server-side cron (checks every minute), per-regimen reminder time picker, dose_log table, `push_subscriptions` table, test notification button
- [x] Running Low — On-Hand Alerts — per-supplement `reorder_threshold` (raw units, opt-in), ⚠ low badge on supplement rows, daily 8am server cron fires push notification with on-hand count + days remaining (calculated from active regimen phase dosage)
- [x] Adherence Tracking — 30-day dot grid per regimen (green=taken, red=skipped, gray=missed), adherence % stat, "Taken today / Skip today" log buttons, change/undo support; SW message listener logs doses tapped from push notifications; `AdherenceCalendar` component in expanded regimen card; quick-log buttons on collapsed cards; "Mark all taken / Skip all" bulk bar
- [x] Shortfall Export — "↓ CSV" button appears after Calculate runs; exports session header, per-regimen rows (on-hand, needed, shortfall, bottles, cost, days short, status), and grand total; zero new dependencies
- [x] Session Templates — save any session as a named template (☆ button); apply when creating a new session to pre-populate all regimens + phases; manage/delete templates in Settings → Templates; backup/restore includes template data
