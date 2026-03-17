# Android App — Feature Backlog

Features present in the web app that still need to be implemented in the Android app (`app/`).
Check off items as they are completed.

---

## Regimen / Session

- [x] Edit session (change dates, notes)
- [x] Copy / duplicate session with new dates
- [ ] Session templates — save as template, create new session from template
- [ ] Multiple sessions open simultaneously (N/A on mobile — single-open is fine)
- [x] Regimen notes field (textarea, auto-save on blur)
- [x] Native date pickers — `@react-native-community/datetimepicker`

---

## Phase Editor

- [x] Add / edit / delete phases
- [x] Indefinite phase support
- [x] Days-of-week selector
- [ ] Phase coverage indicator — show defined days vs session total, remaining, status badge
- [ ] Duration display in weeks ("4wk") when divisible by 7, matching web
- [ ] Dosage label: show "/dose" instead of "/day" (web terminology)
- [ ] Day labels: use "Su Mo Tu We Th Fr Sa" not "S M T W T F S" (ambiguous)

---

## Dose Logging

- [x] Taken / Skip buttons per regimen card
- [x] "Mark all taken" / "Skip all" bulk action bar
- [x] Adherence calendar
- [x] Reminder time picker per regimen
- [x] Push notifications — `expo-notifications` local scheduled reminders
- [ ] Notification tap → auto-log dose

---

## Inventory

- [x] +/− quick-adjust on-hand buttons on regimen card

---

## Supplements

- [ ] Drops per ml field in supplement form (missing from form; field exists in DB)
- [ ] Drops inventory display: "X drops (≈Y ml)" conversion
- [ ] Reorder alert — threshold + units/days mode + "⚠ low" badge on card
- [ ] Unit-aware bottle label ("Caps/bottle", "Tabs/bottle", "Volume/bottle (ml)")
- [ ] Delete supplement from inside edit modal (not overlapping on card)

---

## Shortfall / Calculation

- [x] Shortfall engine (local calculation)
- [x] Shortfall alert card (covered / bottles needed / cost / on-hand)
- [ ] Show "X days short" in shortfall alert (matches web)

---

## Export / Sharing

- [x] Shopping list — share via native share sheet
- [x] CSV export — `expo-file-system` + `expo-sharing`
- [ ] PDF export (lower priority — skip for now)

---

## Settings

- [x] Date format preference (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD)
- [ ] Backup & restore — JSON export/import of all data
- [ ] Color scheme / accent color preference
- [x] Push notification permission request + status
- [ ] Google Drive backup (web-only — N/A for offline app)
- [x] App version display
