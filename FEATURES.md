# PillPipe — Feature Tracker

---

## Prioritized Backlog

### P1 — Build Next

---

#### Meal-Time Dosing Schedules — ⬜ Not Started

Replace the flat single daily dose on each phase with a structured per-meal dosing schedule. Each phase will define its dose through one or more named time slots (Breakfast, Lunch, Dinner, or Custom). The sum of all slot amounts still drives inventory math and low-stock alerts exactly as `daily_dose` did before — the calculator does not need a fundamental rewrite, just needs to pull its number from the slot sum instead of a flat field.

---

##### 1. Data Model — `dosing_slots` Replaces `daily_dose` on Phases

**What exists today:**
Each phase row in the database has a `daily_dose` integer column. It represents the total number of pills taken per day for that regimen during that phase. It is a single flat number with no concept of timing or splitting.

**What needs to change:**
Remove `daily_dose` from the phases table entirely. Add a new child table `dosing_slots` (or store as a JSON column on phases — evaluate at implementation time based on whether we need to query by slot type across regimens). Each slot record belongs to a phase and contains:

- `id` — primary key
- `phase_id` — foreign key to the phase
- `slot_type` — enum: `'breakfast'`, `'lunch'`, `'dinner'`, `'custom'`
- `amount` — integer, number of pills to take at this slot (must be ≥ 1)
- `custom_time` — nullable string in `HH:MM` 24-hour format; only populated when `slot_type = 'custom'`; null for breakfast/lunch/dinner since those resolve to the global meal times set in Settings

A phase must have at least one slot to be valid. There is no enforced maximum slot count. Any combination of B/L/D can be active simultaneously — a phase can have breakfast + dinner but not lunch, or just lunch, or all three, or three custom slots, or a mix.

**Anywhere `daily_dose` is currently read** (calculator route, low-stock alert cron, regimen card display, CSV/PDF export) must be updated to instead **sum `amount` across all slots for that phase**. This sum is the daily dose equivalent and all math remains the same.

**No migration needed** — the app is not in production and there is no existing data to preserve.

---

##### 2. Settings — Global Meal Time Pickers

**What exists today:**
Settings has a single `reminder_time` per regimen (a time picker on each regimen card). There are no global meal-time concepts.

**What needs to change:**
Add a new collapsible section to the Settings page called **"Meal Times"** (sits logically near the existing Preferences section). It contains three time picker inputs:

- **Breakfast time** — default `08:00`
- **Lunch time** — default `12:00`
- **Dinner time** — default `18:00`

These are stored in the server-synced prefs object (`GET/PUT /settings/prefs`) alongside the existing appearance and preference fields. They are included in all backups and restores. They are global — they apply to every regimen in every session. When a user has a regimen with a Breakfast slot, the notification for that slot fires at whatever time is set for Breakfast here.

Time pickers should use the same style/component as the existing `reminder_time` pickers elsewhere in the app for visual consistency.

---

##### 3. Phase Editor UI — Slot Checkboxes + Custom Slot Builder

**What exists today:**
The phase editor form has a single numeric input labeled something like "Daily dose". The user types a number.

**What needs to change:**
Replace the single dose input with a slot selector section. The section contains:

**Predefined slots (Breakfast, Lunch, Dinner):**
Three rows, each with:
- A checkbox to enable/disable that slot
- A label showing the meal name and its current global time pulled from Settings (e.g. "Breakfast — 8:00 AM") so the user knows when it will fire without leaving the form
- A quantity input (integer ≥ 1) that appears/enables only when the checkbox is checked; disabled and visually grayed when unchecked

**Custom slots:**
A collapsible sub-section triggered by an "+ Add Custom Time" button. When expanded, it shows a list of custom slot rows. Each row contains:
- A time picker (HH:MM, 24-hour or AM/PM matching the user's locale/preference)
- A quantity input (integer ≥ 1)
- A remove (×) button to delete that row

The user can add as many custom rows as they want. When the user saves/collapses the custom section, it collapses back into a compact summary line listing the custom slots (e.g. "2 custom slots: 10:30 AM × 1, 2:00 PM × 2"). The interaction pattern mirrors how phases themselves expand/collapse — open to edit, save to collapse into a readable summary.

**Validation:**
At least one slot (predefined or custom) must have its checkbox checked / at least one custom row must exist before the phase can be saved. A custom row is invalid if either the time or the quantity is empty.

---

##### 4. Notification System Overhaul — Batched Per-Time-Slot Push Notifications

**What exists today:**
The server-side cron runs every minute. It checks each regimen's `reminder_time` field. When the current time matches `reminder_time` for a regimen, it fires a push notification for that single regimen. One notification per regimen per day.

**What needs to change:**
The `reminder_time` field on regimens is removed (or repurposed — evaluate at implementation). The notification logic becomes time-slot-driven:

Every minute the cron runs, it:
1. Pulls the global meal times from Settings (breakfast, lunch, dinner)
2. Queries all active phases across all active sessions and joins their `dosing_slots`
3. Resolves each slot to a fire time:
   - `breakfast` slot → global breakfast time
   - `lunch` slot → global lunch time
   - `dinner` slot → global dinner time
   - `custom` slot → the slot's own `custom_time`
4. Groups all slots whose resolved fire time matches the current minute
5. For each unique fire time that matches now, collects all regimens/pills that have a slot at that time and sends **one batched push notification** listing all of them

The batched notification for a given time should read something like:
> **Time to take your pills — 8:00 AM**
> - Magnesium: 1 tablet (with food)
> - Vitamin D: 2 capsules
> - Fish Oil: 1 capsule (with food)

This prevents notification spam — if the user has 7 pills all set to Breakfast, they get one notification at breakfast, not seven. Custom slots fire independently at their own times using the same batching logic (if two custom slots happen to be set to the same time, they batch together too).

The existing per-regimen `reminder_time` picker on regimen cards is removed from the UI since meal times now control notification timing globally + per-slot.

---

##### 5. Regimen Card Display — Compact Slot Breakdown Notation

**What exists today:**
The regimen card shows a flat number like `3 caps/day`.

**What needs to change:**
The display needs to show a breakdown. Proposed compact notation using first-letter abbreviations:

- `B1 D2` — 1 at Breakfast, 2 at Dinner (4 total/day)
- `B1 L1 D1` — 1 at each meal (3 total/day)
- `B2 L1 D2` — mixed amounts per meal
- Custom slots shown as their time: `10:30 AM ×1, 2:00 PM ×2`
- Mixed: `B1 D1 + 10:30 AM ×2`

The exact formatting and where this appears (collapsed card vs. expanded only) is intentionally left flexible — implement it and evaluate visually. The notation above is the starting point but can be adjusted once it's on screen and readable. Total daily dose (sum of all slots) should still be visible somewhere on the card as a secondary stat since it drives the inventory math.

---

##### 6. Calculator & Export Updates — Slot-Summed Daily Dose

**What exists today:**
The calculator reads `daily_dose` directly from the phase record to compute on-hand days, shortfall, bottles needed, and cost. CSV and PDF exports show the daily dose as a flat number.

**What needs to change:**
Everywhere `daily_dose` was read, replace with a query that sums `amount` across all `dosing_slots` for the active phase. This is the only change required for the calculator math to remain correct — the formula itself does not change.

For CSV and PDF exports, add an optional breakdown column or sub-row showing the slot breakdown (e.g. `B1 + D2`) alongside the summed total. This gives a more informative export without breaking the existing column structure.

---

##### 7. "Take With Food" Flag — On the Supplement Record

**What exists today:**
Supplements have fields like name, unit, drops_per_ml, reorder_threshold, etc. There is no food-related metadata.

**What needs to change:**
Add a boolean `take_with_food` field to the supplement record (defaults to false). This is set when creating or editing a supplement in inventory — a simple toggle/checkbox labeled "Take with food". It is a property of the pill itself, not of any specific dosing schedule or phase, because in practice a pill is either always taken with food or never with food — there is no known use case for "with food in the morning but without food at night."

This flag surfaces in the regimen view as a small indicator on the regimen card — likely a food/fork icon or a "(with food)" label — so at a glance the user can see: what they take, when they take it, how many, and whether food is required. It also appears in the batched push notification text (see section 4 above) so the reminder itself includes the food context.

No changes to the calculator or inventory math — this is display/reminder metadata only.

---

##### 8. "As Needed" (PRN) Dosing — Concept Reserved, Implementation Deferred

Some pills are not taken on a schedule — they are taken only when symptoms arise (pain, allergies, anxiety, etc.). These are called PRN (pro re nata) in medical terminology.

**Concept:**
A phase (or a supplement) could be flagged as `as_needed: true`. When flagged:
- No slots are defined (no scheduled times)
- No push notifications are scheduled for it
- It does not contribute to `daily_dose` calculations or shortfall math
- It still appears in the active regimen card with a clear "As Needed" label so the user knows it's in their current regimen
- Inventory tracking still applies — the user can still log when they take it for adherence purposes if desired

**Status:** Feature concept is documented and reserved. Do not implement alongside the meal-time dosing work. Revisit as a separate feature once slot-based dosing is shipped — the two systems need to coexist cleanly and that interaction should be designed intentionally.

---

---

### P2 — Near Term

*All P2 items complete. See Completed section below.*

---

### P3 — Medium Term

*All P3 items complete. See Completed section.*

---

### P4 — Later

#### ~~Google SSO + Drive Backup~~ — ✅ Shipped

See Completed section and README → Google Drive Backup Setup.

---

#### Donate Section — 🚧 WIP (hidden)

Code is in place (`false &&` guard in Settings). Hidden until Ko-fi / GitHub Sponsors pages are set up. Re-enable by removing the `false &&` in Dashboard.jsx.

---



#### ~~Multiple Active Sessions~~ — ✅ Shipped

See Completed section below.

---

### P5 — Long Term

#### Flexible Ads
**Effort:** Medium | **Value:** Medium — supports the project without forcing users into a paywall

Moved to P5 — donations are the preferred support mechanism. Revisit if the app grows a larger public user base.

User-controlled ad experience. Most people don't like ads — that's fine, the default is ad-free. But for users who want to support the project passively, they can opt into progressively more ads. Critically, **ad-free is always free** — there is no "pay to remove ads" model.

**Ad levels (user's choice, persisted in Settings)**

| Level | Name | Description |
|---|---|---|
| 0 | **Ad-Free** *(default)* | No ads anywhere. Expected to be where most users stay. |
| 1 | **Light** | Small, non-intrusive placements — banners, sidebars where space exists. Never interrupts workflow. |
| 2 | **Normal** | Ads wherever they fit. More cluttered but nothing that blocks content or requires interaction. |
| 3 | **Max** | Everything from Normal plus intrusive formats — full-screen takeovers, unskippable interstitials. For users who really want to support the project. |

**Design principles**
- Ad-free is the default. No opt-out required — users opt *in* to ads.
- No paywalls. The app is fully functional at level 0, forever.
- The user is always in control. Level can be changed at any time in Settings.
- Levels are additive — higher levels include all placements from lower levels.
- Level 3 is intentionally over-the-top; it exists for users who want maximum contribution, not as a dark pattern.

**Decisions made**
- Ad network: **Google AdSense** for now. Affiliate links are appealing but require active management — revisit later if there's demand.
- Privacy warning: enabling any ad level (1+) shows a one-time confirmation dialog informing the user that AdSense will send data to Google. User must explicitly accept before ads activate.
- Confirmation dialogs: **every level change** requires confirmation, not just level 3. Users should never feel tricked into turning ads on.
- Level 3 confirmation is extra explicit — describes exactly what "intrusive" means (full-screen takeovers, unskippable interstitials) before the user commits.
- Ad level stored in **localStorage** (local to device). No server sync for now — revisit if multi-device demand comes up.

---

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
- [x] Data backup, restore, and clear (Settings → Data section) — backup includes all DB data + client prefs (appearance, preferences); reminder_time restored correctly
- [x] Settings page — full-screen tab with collapsible sections; SVG cog icon in nav; Appearance + Preferences section shells present (content tracked in backlog)
- [x] Version handling — `GET /version` endpoint; version read from `package.json`; displayed in Settings footer
- [x] About section — collapsible Settings section; pill icon, version, description, GitHub link, MIT license
- [x] Liquid & Drops support — `unit` field (capsules/tablets/ml/drops), `drops_per_ml` override, dynamic labels throughout UI, decimal dosage/inventory for ml, drops↔ml conversion in calculator route
- [x] Dose Reminders & Notifications — Web Push (VAPID), service worker, subscribe/unsubscribe in Settings, server-side cron (checks every minute), per-regimen reminder time picker, dose_log table, `push_subscriptions` table, test notification button
- [x] Running Low — On-Hand Alerts — per-supplement `reorder_threshold` (raw units, opt-in), ⚠ low badge on supplement rows, daily 8am server cron fires push notification with on-hand count + days remaining (calculated from active regimen phase dosage)
- [x] Adherence Tracking — 30-day dot grid per regimen (green=taken, red=skipped, gray=missed), adherence % stat, "Taken today / Skip today" log buttons, change/undo support; SW message listener logs doses tapped from push notifications; `AdherenceCalendar` component in expanded regimen card; quick-log buttons on collapsed cards; "Mark all taken / Skip all" bulk bar
- [x] Shortfall Export — "↓ CSV" button appears after Calculate runs; exports session header, per-regimen rows (on-hand, needed, shortfall, bottles, cost, days short, status), and grand total; zero new dependencies
- [x] Session Templates — save any session as a named template (☆ button); apply when creating a new session to pre-populate all regimens + phases; manage/delete templates in Settings → Templates; backup/restore includes template data
- [x] Google Drive Backup — OAuth2 connect via Google; manual, daily, or on-change backup modes; JSON backup uploaded to Drive with timestamped filenames; view and restore any previous backup from Settings → Data; tokens stored in DB; server-side cron for scheduled backups; on-change middleware triggers backup after successful mutations
- [x] Appearance Settings — theme color picker (6 presets: violet/blue/cyan/green/orange/rose + custom color via HSL shade derivation); font size (small/medium/large via root font-size); CSS variable swap applies across all components instantly; persisted to localStorage and synced to server (`GET/PUT /settings/prefs`); included in all backups
- [x] Preferences Settings — date format (locale/MM-DD-YYYY/DD-MM-YYYY/YYYY-MM-DD) applied to session card dates and CSV export; default session duration (none/30/60/90/120 days) pre-fills target date when new session form opens; persisted to localStorage and synced to server alongside appearance prefs
- [x] Multiple Active Sessions — sessions sidebar shows all sessions as a unified list; click any session to toggle it open/closed; multiple sessions can be open simultaneously in the main pane, each managed by a self-contained `SessionPane` component; `SessionPane.jsx` extracted from Dashboard
- [x] Reorder Shopping List — post-Calculate modal listing all shortfall items (name, bottles needed, cost), grand total, one-click copy to clipboard; triggered via "🛒 List" button alongside CSV export
- [x] Dark / Light Mode Toggle — Color Scheme setting in Appearance (System/Dark/Light); `html.light` class swaps the full gray scale via CSS variable overrides; system mode auto-follows `prefers-color-scheme` with a media query listener; stored in server-synced prefs
- [x] PDF Export — "↓ PDF" button post-Calculate; jsPDF + jspdf-autotable; session header, per-regimen results table (on-hand, needed, shortfall, bottles, cost, status), grand total footer; client-side only
- [ ] Donate / Support Section — code complete, hidden behind `false &&` guard; activate once Ko-fi / GitHub Sponsors pages are live
