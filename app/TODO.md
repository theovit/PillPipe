# Android App — Feature Backlog

Features present in the web app that still need to be implemented in the Android app (`app/`).
Check off items as they are completed.

---

## Regimen / Session

- [ ] Edit session (change dates, notes)
- [ ] Copy / duplicate session with new dates
- [ ] Session templates — save a session as a template, create new session from template
- [ ] Multiple sessions open simultaneously (web supports expanding several at once)
- [x] Regimen notes field (textarea, auto-save on blur)
- [ ] Native date pickers — replace bare TextInput with `@react-native-community/datetimepicker`

---

## Dose Logging

- [x] Taken / Skip buttons per regimen card
- [x] "Mark all taken" / "Skip all" bulk action bar
- [ ] Adherence calendar (`AdherenceCalendar` equivalent)
- [ ] Reminder time picker per regimen
- [ ] Push notifications via `expo-notifications` — local scheduled reminders + dose-tap action

---

## Inventory

- [ ] +/− quick-adjust on-hand buttons on regimen card (bump inventory without opening Supplements tab)

---

## Export / Sharing

- [x] Shopping list — display items to buy, share via native share sheet
- [ ] CSV export — share/save via `expo-sharing` or `expo-file-system`
- [ ] PDF export (lower priority on mobile)

---

## Settings

- [ ] Date format preference (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD)
- [ ] Color scheme / accent color preference
- [ ] Push notification permission request + status
- [ ] Google Drive backup
- [ ] App version display

---

## Build Order (suggested)

1. Dose logging — Taken/Skip + bulk bar
2. Adherence calendar
3. Regimen notes
4. Native date pickers
5. Shopping list / share sheet
6. Edit + copy session
7. Session templates
8. Settings (date format, theme)
9. Push notifications (expo-notifications)
10. CSV export
11. PDF export
