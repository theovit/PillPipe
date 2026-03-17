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

## Dose Logging

- [x] Taken / Skip buttons per regimen card
- [x] "Mark all taken" / "Skip all" bulk action bar
- [x] Adherence calendar
- [x] Reminder time picker per regimen
- [x] Push notifications — `expo-notifications` local scheduled reminders

---

## Inventory

- [x] +/− quick-adjust on-hand buttons on regimen card

---

## Export / Sharing

- [x] Shopping list — share via native share sheet
- [x] CSV export — `expo-file-system` + `expo-sharing`
- [ ] PDF export (lower priority — skip for now)

---

## Settings

- [x] Date format preference (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD)
- [ ] Color scheme / accent color preference
- [x] Push notification permission request + status
- [ ] Google Drive backup (web-only — N/A for offline app)
- [x] App version display
