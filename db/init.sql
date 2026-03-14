CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS supplements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  brand             TEXT,
  pills_per_bottle  INTEGER NOT NULL,
  price             NUMERIC(10, 2),
  type              TEXT NOT NULL CHECK (type IN ('maintenance', 'protocol')),
  current_inventory INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date    DATE NOT NULL,
  target_date   DATE NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS regimens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  supplement_id UUID NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS phases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regimen_id     UUID NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
  dosage         INTEGER NOT NULL,
  duration_days  INTEGER NOT NULL,
  days_of_week   INTEGER[],        -- NULL = every day; 0=Sun 1=Mon ... 6=Sat
  indefinite     BOOLEAN NOT NULL DEFAULT FALSE,
  sequence_order INTEGER NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (regimen_id, sequence_order)
);

-- Seed data
INSERT INTO supplements (name, brand, pills_per_bottle, price, type) VALUES
  ('Magnesium Glycinate', 'Thorne', 60, 24.99, 'maintenance'),
  ('Vitamin D3', 'NOW Foods', 90, 12.99, 'maintenance'),
  ('LDN', 'Custom', 30, 49.99, 'protocol')
ON CONFLICT DO NOTHING;
