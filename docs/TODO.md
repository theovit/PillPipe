# TODO

## WIP
- [ ] Android app — React Native / Expo; offline-first SQLite; parity pass with web features ongoing

## High
- [ ] Meal-Time Dosing Schedules — replace flat `daily_dose` with per-meal slot system (B/L/D + custom times)
  - [ ] 1. Data model — `dosing_slots` table replaces `daily_dose` on phases
  - [ ] 2. Settings — global meal time pickers (Breakfast/Lunch/Dinner defaults)
  - [ ] 3. Phase editor UI — slot checkboxes + custom slot builder
  - [ ] 4. Notification overhaul — batched per-time-slot push notifications
  - [ ] 5. Regimen card display — compact slot breakdown notation (B1 D2 etc.)
  - [ ] 6. Calculator & export updates — sum slots instead of reading daily_dose
  - [ ] 7. "Take With Food" flag on supplement record
  - [ ] 8. "As Needed" dosing — UI-only flag on regimen; no slots, no notifications, no inventory math; shows "As Needed" label on card

## Long-term
- [ ] Authentication — JWT-based login for multi-user or public hosting; blocked on decision to open app to public internet
- [ ] Flexible Ads — opt-in ad system (ad-free default); AdSense; four levels; deferred until larger public user base
- [ ] Doctor Portal — multi-tenant support for healthcare providers; requires auth + user/role model first
- [ ] Activate Donate / Support section — remove `false &&` guard in Dashboard.jsx once Ko-fi / GitHub Sponsors pages are live
