import * as SQLite from 'expo-sqlite';

// Cache the Promise (not the result) to prevent concurrent openDatabaseAsync calls
// on the same database file, which causes NullPointerException on Android.
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_dbPromise) {
    _dbPromise = _initDb();
  }
  return _dbPromise;
}

async function _initDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('pillpipe.db');
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(db);
  if (__DEV__) {
    try {
      // seed.dev.ts is gitignored — only present in local dev environments
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { seedIfEmpty } = require('./seed.dev');
      await seedIfEmpty(db);
    } catch { /* file not present — skip */ }
  }
  return db;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  // Split into separate execAsync calls — a single multi-statement call with
  // complex CHECK constraints can silently fail on some Android/expo-sqlite builds.
  await db.execAsync(`CREATE TABLE IF NOT EXISTS supplements (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    brand             TEXT,
    pills_per_bottle  REAL NOT NULL DEFAULT 60,
    price             REAL DEFAULT 0,
    type              TEXT NOT NULL DEFAULT 'maintenance'
                        CHECK (type IN ('maintenance', 'protocol')),
    current_inventory REAL NOT NULL DEFAULT 0,
    unit              TEXT NOT NULL DEFAULT 'capsules'
                        CHECK (unit IN ('capsules','tablets','ml','drops')),
    drops_per_ml      REAL DEFAULT 20,
    reorder_threshold REAL,
    reorder_threshold_mode TEXT DEFAULT 'units',
    created_at        TEXT DEFAULT (datetime('now'))
  );`);

  await db.execAsync(`CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    start_date  TEXT NOT NULL,
    target_date TEXT NOT NULL,
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );`);

  await db.execAsync(`CREATE TABLE IF NOT EXISTS regimens (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    supplement_id TEXT NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
    notes         TEXT,
    reminder_time TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );`);

  await db.execAsync(`CREATE TABLE IF NOT EXISTS phases (
    id             TEXT PRIMARY KEY,
    regimen_id     TEXT NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
    dosage         REAL NOT NULL,
    duration_days  INTEGER NOT NULL DEFAULT 30,
    days_of_week   TEXT,
    indefinite     INTEGER NOT NULL DEFAULT 0,
    sequence_order INTEGER NOT NULL,
    created_at     TEXT DEFAULT (datetime('now')),
    UNIQUE (regimen_id, sequence_order)
  );`);

  await db.execAsync(`CREATE TABLE IF NOT EXISTS dose_log (
    id          TEXT PRIMARY KEY,
    regimen_id  TEXT NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
    log_date    TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('taken','skipped')),
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE (regimen_id, log_date)
  );`);

  await db.execAsync(`CREATE TABLE IF NOT EXISTS session_templates (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );`);

  await db.execAsync(`CREATE TABLE IF NOT EXISTS regimen_notifications (
    id          TEXT PRIMARY KEY,
    regimen_id  TEXT NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('morning','lunch','dinner','custom')),
    custom_time TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );`);

  await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_regimen_notif_preset
    ON regimen_notifications(regimen_id, type)
    WHERE type != 'custom';`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
