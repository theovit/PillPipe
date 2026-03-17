import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('pillpipe.db');
  await _db.execAsync('PRAGMA journal_mode = WAL;');
  await _db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(_db);
  await seed(_db);
  return _db;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS supplements (
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
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      start_date  TEXT NOT NULL,
      target_date TEXT NOT NULL,
      notes       TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS regimens (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      supplement_id TEXT NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
      notes         TEXT,
      reminder_time TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS phases (
      id             TEXT PRIMARY KEY,
      regimen_id     TEXT NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
      dosage         REAL NOT NULL,
      duration_days  INTEGER NOT NULL DEFAULT 30,
      days_of_week   TEXT,
      indefinite     INTEGER NOT NULL DEFAULT 0,
      sequence_order INTEGER NOT NULL,
      created_at     TEXT DEFAULT (datetime('now')),
      UNIQUE (regimen_id, sequence_order)
    );

    CREATE TABLE IF NOT EXISTS dose_log (
      id          TEXT PRIMARY KEY,
      regimen_id  TEXT NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
      log_date    TEXT NOT NULL,
      status      TEXT NOT NULL CHECK (status IN ('taken','skipped')),
      created_at  TEXT DEFAULT (datetime('now')),
      UNIQUE (regimen_id, log_date)
    );
  `);
}

// ── Seed data ─────────────────────────────────────────────────────────────────

async function seed(db: SQLite.SQLiteDatabase): Promise<void> {
  const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM supplements');
  if ((existing?.n ?? 0) > 0) return; // already seeded

  const today = new Date().toISOString().slice(0, 10);
  const target = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  const supVitD   = uuid();
  const supMag    = uuid();
  const supOmega  = uuid();
  const supVitC   = uuid();

  await db.execAsync(`
    INSERT INTO supplements (id, name, brand, pills_per_bottle, price, type, current_inventory, unit) VALUES
      ('${supVitD}',  'Vitamin D3',           'Thorne',    60, 14.99, 'maintenance', 85,  'capsules'),
      ('${supMag}',   'Magnesium Glycinate',  'Pure Encap',90, 24.99, 'maintenance', 120, 'capsules'),
      ('${supOmega}', 'Omega-3 Fish Oil',     'Nordic Nat',60, 29.99, 'maintenance', 45,  'capsules'),
      ('${supVitC}',  'Vitamin C 1000mg',     '',          90, 12.99, 'maintenance', 200, 'tablets');

    INSERT INTO sessions (id, start_date, target_date, notes) VALUES
      ('ses1', '${today}', '${target}', 'Demo session — 90 days');
  `);

  const rD   = uuid();
  const rMag = uuid();
  const rO   = uuid();
  const rC   = uuid();

  await db.execAsync(`
    INSERT INTO regimens (id, session_id, supplement_id, notes) VALUES
      ('${rD}',   'ses1', '${supVitD}',  'Take with breakfast'),
      ('${rMag}', 'ses1', '${supMag}',   'Take before bed'),
      ('${rO}',   'ses1', '${supOmega}', 'Take with food'),
      ('${rC}',   'ses1', '${supVitC}',  null);

    INSERT INTO phases (id, regimen_id, dosage, duration_days, indefinite, sequence_order) VALUES
      ('${uuid()}', '${rD}',   2, 9999, 1, 0),
      ('${uuid()}', '${rMag}', 2,   30, 0, 0),
      ('${uuid()}', '${rMag}', 1, 9999, 1, 1),
      ('${uuid()}', '${rO}',   1, 9999, 1, 0),
      ('${uuid()}', '${rC}',   1,   30, 0, 0),
      ('${uuid()}', '${rC}',   2, 9999, 1, 1);

    INSERT INTO dose_log (id, regimen_id, log_date, status) VALUES
      ('${uuid()}', '${rD}',   '${today}', 'taken'),
      ('${uuid()}', '${rMag}', '${today}', 'taken'),
      ('${uuid()}', '${rO}',   '${today}', 'skipped');
  `);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
