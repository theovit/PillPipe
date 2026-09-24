# Android App — Feature Backlog

Features present in the web app that still need to be implemented in the Android app (`app/`).
App is currently in **alpha** — items marked [x] are scaffolded but may not be fully reliable.

---

## Needs Fixing (built but broken)

- [x] Adherence calendar — built but not working correctly; verify parity with web
- [x] Push notifications — local scheduling unreliable; fix and verify
- [x] Backup & restore — partially implemented; fix JSON export/import end-to-end

---

## Regimen / Session

- [x] Edit session (change dates, notes)
- [x] Copy / duplicate session with new dates
- [x] Session templates — save as template, create new session from template
- [ ] Multiple sessions open simultaneously (N/A on mobile — single-open is fine)
- [x] Regimen notes field (textarea, auto-save on blur)
- [x] Native date pickers — `@react-native-community/datetimepicker`

---

## High

- [ ] Include session_templates and regimen_notifications in backup export/restore and clear-all-data (currently excluded — `SettingsScreen.tsx` only exports supplements, sessions, regimens, phases, dose_log)
- [x] Add onRequestClose to Modal in SupplementsScreen (done — `SupplementsScreen.tsx:221`)

---

## Phase Editor

- [x] Add / edit / delete phases
- [x] Indefinite phase support
- [x] Days-of-week selector
- [x] Phase coverage indicator — show defined days vs session total, remaining, status badge
- [x] Duration display in weeks ("4wk") when divisible by 7, matching web
- [x] Dosage label: show "/dose" instead of "/day" (web terminology)
- [x] Day labels: use "Su Mo Tu We Th Fr Sa" not "S M T W T F S" (ambiguous)

---

## Dose Logging

- [x] Taken / Skip buttons per regimen card
- [x] "Mark all taken" / "Skip all" bulk action bar
- [x] Adherence calendar
- [x] Reminder time picker per regimen
- [x] Push notifications — `expo-notifications` local scheduled reminders
- [x] Notification tap → auto-log dose

---

## Inventory

- [x] +/− quick-adjust on-hand buttons on regimen card

---

## Supplements

- [x] Drops per ml field in supplement form (missing from form; field exists in DB)
- [x] Drops inventory display: "X drops (≈Y ml)" conversion
- [x] Reorder alert — threshold + units/days mode + "⚠ low" badge on card
- [x] Unit-aware bottle label ("Caps/bottle", "Tabs/bottle", "Volume/bottle (ml)")
- [x] Delete supplement from inside edit modal (not overlapping on card)

---

## Shortfall / Calculation

- [x] Shortfall engine (local calculation)
- [x] Shortfall alert card (covered / bottles needed / cost / on-hand)
- [x] Show "X days short" in shortfall alert (matches web)

---

## Export / Sharing

- [x] Shopping list — share via native share sheet
- [x] CSV export — `expo-file-system` + `expo-sharing`
- [ ] PDF export (lower priority — skip for now)

---

## Settings

- [x] Date format preference (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD)
- [x] Backup & restore — JSON export/import of all data
- [x] Color scheme / accent color preference
- [x] Push notification permission request + status
- [ ] Google Drive backup (web-only — N/A for offline app)
- [x] App version display

## Sync / Remote Server Mode (long-term, not started — noted 2026-09-24)

App is offline-first SQLite only today (see `app/CLAUDE.md` "What This App Does NOT Have" —
no network calls). This would be a real architecture change, not a small feature. Also needs
the web app's multi-user login first if the point is multiple people sharing one server
(`docs/TODO.md` Long-term) — a URL field alone doesn't give each person their own account.

- [ ] Settings: optional field for a hosted PillPipe server's public address (e.g. the Unraid/tunnel URL)
- [ ] Initial connect, direction depends on which side already has data:
  - [ ] **Push** — app already has local data, user then stands up a server: push local → server as the seed
  - [ ] **Pull** — server already has data (they were using the web app first), user then installs the app: pull server → local as the seed
- [ ] After the initial connect, user picks the ongoing mode:
  - [ ] **Pull once, then local** — app becomes the source of truth from then on; server isn't touched again unless the user reconnects manually
  - [ ] **Keep syncing** — server stays live going forward (two-way), effectively an offsite backup as well as a shared store
- [ ] Two-way sync needs a conflict resolution rule (same regimen edited on both app and web before a sync runs — last-write-wins? merge? reject and ask?) — not designed yet
- [ ] Network-loss handling — what the app does with local edits made while the server's unreachable, given it's built offline-first

## Found while porting meal-time dosing to the web app (2026-09-19)

- [ ] Parity: `take_with_food` on supplements and `as_needed` on regimens (web has both; label-only semantics — see `docs/DECISIONS.md`)
- [ ] Parity: reminders derived from phase dose times (web sends one batched push per time); Android reminders are independent of phases and fire every day regardless of phase, days-of-week or session
- [ ] Backup format: web backups are now version 2 and Android's are not interchangeable with them (different column shapes)
- [ ] Bug: bottle math for **drops** never converts the ml bottle size to drops, so bottles/waste are ~20x off (web converts in the route)
- [ ] Bug: deleting a session (or restore / clear-all) leaves its scheduled OS reminders firing
- [ ] Bug: "Copy session" leaves the target date blank, so the new session shows NaN days until edited
- [ ] Cleanup: `dose_custom` duplicates `custom_slots` (web derives the total instead); `dosage` and `custom_time` are dead columns still copied into templates and backups
