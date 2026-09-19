# TODO

## WIP
- [ ] Android app — React Native / Expo; offline-first SQLite; parity pass with web features ongoing (granular status in `app/TODO.md`)

## High
- [ ] Dependency vulnerabilities (`npm audit --omit=dev`, 2026-09-19): server 6 (2 high; `qs`, `uuid` via `node-cron`), app 35 (2 critical, 18 high — mostly Expo/RN tooling, `ws`, `yaml`), client 3 (1 critical: `jspdf` ≤4.2.0 object/HTML injection; plus `dompurify`, `fflate`). `npm audit fix` is available for the client, `qs`, `ws` and `yaml`. Client installs need `--legacy-peer-deps` (vite 8 vs `@tailwindcss/vite` peer range; same flag as `client/Dockerfile`).
- [ ] Find what writes `// @atlas-entrypoint: …` first-line comments into source files (removed 2026-09-19; source unconfirmed) — if it re-adds them, disable it.
- [ ] Meal-time dosing — **Android done, web/server not started.** Android shipped a simpler design than the planned `dosing_slots` table (see DECISIONS): fixed `dose_morning/lunch/dinner/custom` columns + `custom_slots` JSON on phases, Morning/Lunch/Dinner time prefs, per-regimen multi-slot local notifications. Remaining:
  - [ ] Web/server port — schema (`phases` still has flat `dosage`), Settings meal-time pickers, phase editor, calculator, backup/templates
  - [ ] Web notification overhaul — batched per-time-slot push; replaces per-regimen `reminder_time`
  - [ ] Compact slot notation on regimen cards (B1 L1 D2). Android currently shows "1 morning · 2 dinner" text
  - [ ] "Take With Food" flag on supplement record
  - [ ] "As Needed" dosing — UI-only flag on regimen; no slots, no notifications, no inventory math; shows "As Needed" label on card

## Long-term
- [ ] Authentication — JWT-based login for multi-user or public hosting; blocked on decision to open app to public internet
- [ ] Flexible Ads — opt-in ad system (ad-free default); AdSense; four levels; deferred until larger public user base
- [ ] Doctor Portal — multi-tenant support for healthcare providers; requires auth + user/role model first
- [ ] Activate Donate / Support section — remove `false &&` guard in Dashboard.jsx once Ko-fi / GitHub Sponsors pages are live
