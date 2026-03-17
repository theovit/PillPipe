# PillPipe — Android / Expo App

This CLAUDE.md applies only to the `app/` directory. The app is a standalone project.

## Boundary Rules

**When working in `app/`, do not touch anything outside of `app/`.**

Off-limits while in this context:
- `../client/` — web frontend
- `../server/` — Express backend
- `../db/` — PostgreSQL schema
- `../docker-compose.yml` — web stack infrastructure
- `../docs/` — update only if a feature status changes (FEATURES.md lifecycle marker)

If a change is needed in both the app and the web stack, flag it to the user and handle them as separate tasks.

---

## Project Overview

Offline-first Android (and iOS/web) app built with Expo. No backend server required — all data lives in local SQLite on the device. The shortfall engine runs entirely on-device.

This is a **separate project** from the web app. It shares the same product concept but has its own:
- Data layer (SQLite instead of PostgreSQL)
- No Docker, no Express, no Vite
- Its own `node_modules`, `package.json`, and build toolchain

---

## Commands

```bash
# Run in Expo Go (scan QR code with phone)
npx expo start

# Run on Android emulator or connected device
npx expo run:android

# Run in browser (limited — some native APIs won't work)
npx expo start --web
```

Run all commands from inside the `app/` directory.

**Expo SDK is pinned to SDK 54** to match Expo Go 54.0.6. Do not upgrade Expo or React Native versions without checking Expo Go compatibility first.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Expo SDK 54, React Native 0.81 |
| Language | TypeScript |
| Navigation | React Navigation (bottom tabs + native stack) |
| Styling | NativeWind 4 (Tailwind CSS v3 for React Native) |
| Database | expo-sqlite (local SQLite, no network required) |
| Notifications | expo-notifications (local scheduled, no server cron) |
| File I/O | expo-file-system + expo-sharing (CSV export, backup) |
| Date picker | @react-native-community/datetimepicker |

---

## Architecture

```
App.tsx → React Navigation
  └── Bottom tabs: Sessions | Supplements | Settings
        └── Stack navigators per tab
              └── Screens → SQLite via db.ts helpers
```

- **No network calls** — all reads/writes go to local SQLite
- **Shortfall engine** — ported from `server/calculator.js`, runs on-device
- **Notifications** — local scheduled via `expo-notifications`; no server cron
- **Backup/restore** — JSON export/import via `expo-file-system` and `expo-sharing`
- **Styling** — NativeWind with `global.css`; `tailwind.config.js` at root of `app/`

---

## Key Files

| File | Role |
|---|---|
| `App.tsx` | Root component; navigation setup |
| `index.ts` | Entry point |
| `app.json` | Expo config — bundle ID, icons, plugins |
| `metro.config.js` | Metro bundler config; includes NativeWind and WASM allowlist |
| `babel.config.js` | Babel preset + module-resolver for `@/` path alias |
| `global.css` | NativeWind base styles |
| `TODO.md` | App-specific parity tracker vs web app — check this before starting work |

---

## Parity Tracking

`app/TODO.md` tracks which web features are implemented, partially done, or missing in the app.
Check it at session start. It is the source of truth for app feature status — more granular than
`../docs/TODO.md`.

---

## Platform Notes

- **Target platform is Android** — iOS and web are secondary. Test on Android first.
- **Expo Go** is the primary dev target (SDK 54). Native builds via `expo run:android` for features
  that require native modules not available in Expo Go.
- **WASM** — allowed in Metro config; required for some packages. Do not remove WASM allowlist
  from `metro.config.js`.
- **Path alias** — `@/` resolves to the `app/` root via `babel-plugin-module-resolver`.

---

## What This App Does NOT Have

- No Docker
- No Express server
- No PostgreSQL
- No Web Push / VAPID notifications (uses local `expo-notifications` instead)
- No Google Drive backup (offline-only; local export/import only)
- No Tailscale (local device, no remote access needed)
