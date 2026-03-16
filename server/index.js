const express = require('express');
const cron = require('node-cron');
const webpush = require('web-push');
const pool = require('./db');
const { calculate } = require('./calculator');
const { version } = require('./package.json');

// ── Web Push / VAPID setup ────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@pillpipe.local',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

const app = express();
app.use(express.json());

const w = fn => (req, res, next) => fn(req, res, next).catch(next);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/version', (req, res) => res.json({ version }));

// ── Supplements ───────────────────────────────────────────────────────────────
app.get('/supplements', w(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM supplements ORDER BY name');
  res.json(rows);
}));

app.post('/supplements', w(async (req, res) => {
  const { name, brand, pills_per_bottle, price, type, current_inventory, unit, drops_per_ml } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO supplements (name, brand, pills_per_bottle, price, type, current_inventory, unit, drops_per_ml)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [name, brand, pills_per_bottle, price, type, current_inventory ?? 0, unit || 'capsules', drops_per_ml ?? 20]
  );
  res.status(201).json(rows[0]);
}));

app.put('/supplements/:id', w(async (req, res) => {
  const { name, brand, pills_per_bottle, price, type, current_inventory, unit, drops_per_ml } = req.body;
  const { rows } = await pool.query(
    `UPDATE supplements SET name=$1, brand=$2, pills_per_bottle=$3, price=$4, type=$5, current_inventory=$6, unit=$7, drops_per_ml=$8
     WHERE id=$9 RETURNING *`,
    [name, brand, pills_per_bottle, price, type, current_inventory ?? 0, unit || 'capsules', drops_per_ml ?? 20, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

app.patch('/supplements/:id', w(async (req, res) => {
  const { current_inventory } = req.body;
  const { rows } = await pool.query(
    `UPDATE supplements SET current_inventory=$1 WHERE id=$2 RETURNING *`,
    [Math.max(0, current_inventory), req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

app.delete('/supplements/:id', w(async (req, res) => {
  await pool.query('DELETE FROM supplements WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

// ── Sessions ──────────────────────────────────────────────────────────────────
app.get('/sessions', w(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM sessions ORDER BY target_date DESC');
  res.json(rows);
}));

app.post('/sessions', w(async (req, res) => {
  const { start_date, target_date, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO sessions (start_date, target_date, notes) VALUES ($1,$2,$3) RETURNING *`,
    [start_date, target_date, notes || null]
  );
  res.status(201).json(rows[0]);
}));

app.put('/sessions/:id', w(async (req, res) => {
  const { start_date, target_date, notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE sessions SET start_date=$1, target_date=$2, notes=$3 WHERE id=$4 RETURNING *`,
    [start_date, target_date, notes || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

app.post('/sessions/:id/copy', w(async (req, res) => {
  const { start_date, target_date, notes } = req.body;
  const { rows: [newSession] } = await pool.query(
    `INSERT INTO sessions (start_date, target_date, notes) VALUES ($1,$2,$3) RETURNING *`,
    [start_date, target_date, notes || null]
  );
  const { rows: srcRegimens } = await pool.query(
    'SELECT * FROM regimens WHERE session_id=$1', [req.params.id]
  );
  for (const r of srcRegimens) {
    const { rows: [newRegimen] } = await pool.query(
      'INSERT INTO regimens (session_id, supplement_id) VALUES ($1,$2) RETURNING *',
      [newSession.id, r.supplement_id]
    );
    const { rows: srcPhases } = await pool.query(
      'SELECT * FROM phases WHERE regimen_id=$1 ORDER BY sequence_order', [r.id]
    );
    for (const p of srcPhases) {
      await pool.query(
        'INSERT INTO phases (regimen_id, dosage, duration_days, days_of_week, sequence_order) VALUES ($1,$2,$3,$4,$5)',
        [newRegimen.id, p.dosage, p.duration_days, p.days_of_week, p.sequence_order]
      );
    }
  }
  res.status(201).json(newSession);
}));

app.delete('/sessions/:id', w(async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

// ── Regimens ──────────────────────────────────────────────────────────────────
app.get('/sessions/:sessionId/regimens', w(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, s.name AS supplement_name, s.brand, s.pills_per_bottle, s.price, s.type, s.current_inventory, s.unit, s.drops_per_ml
     FROM regimens r
     JOIN supplements s ON s.id = r.supplement_id
     WHERE r.session_id = $1`,
    [req.params.sessionId]
  );
  res.json(rows);
}));

app.post('/sessions/:sessionId/regimens', w(async (req, res) => {
  const { supplement_id } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO regimens (session_id, supplement_id) VALUES ($1,$2) RETURNING *`,
    [req.params.sessionId, supplement_id]
  );
  res.status(201).json(rows[0]);
}));

app.patch('/regimens/:id', w(async (req, res) => {
  const { notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE regimens SET notes=$1 WHERE id=$2 RETURNING *`,
    [notes || null, req.params.id]
  );
  res.json(rows[0]);
}));

app.delete('/regimens/:id', w(async (req, res) => {
  await pool.query('DELETE FROM regimens WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

// ── Phases ────────────────────────────────────────────────────────────────────
app.get('/regimens/:regimenId/phases', w(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM phases WHERE regimen_id=$1 ORDER BY sequence_order`,
    [req.params.regimenId]
  );
  res.json(rows);
}));

app.post('/regimens/:regimenId/phases', w(async (req, res) => {
  const { dosage, duration_days, days_of_week, sequence_order, indefinite } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO phases (regimen_id, dosage, duration_days, days_of_week, sequence_order, indefinite)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.regimenId, dosage, indefinite ? 9999 : duration_days, days_of_week || null, sequence_order, !!indefinite]
  );
  res.status(201).json(rows[0]);
}));

app.put('/phases/:id', w(async (req, res) => {
  const { dosage, duration_days, days_of_week, sequence_order, indefinite } = req.body;
  const { rows } = await pool.query(
    `UPDATE phases SET dosage=$1, duration_days=$2, days_of_week=$3, sequence_order=$4, indefinite=$5 WHERE id=$6 RETURNING *`,
    [dosage, indefinite ? 9999 : duration_days, days_of_week || null, sequence_order, !!indefinite, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

app.delete('/phases/:id', w(async (req, res) => {
  await pool.query('DELETE FROM phases WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

// ── Shortfall Engine ──────────────────────────────────────────────────────────
app.get('/sessions/:sessionId/calculate', w(async (req, res) => {
  const { rows: sessionRows } = await pool.query(
    'SELECT * FROM sessions WHERE id=$1', [req.params.sessionId]
  );
  if (!sessionRows.length) return res.status(404).json({ error: 'Session not found' });
  const session = sessionRows[0];

  const { rows: regimens } = await pool.query(
    `SELECT r.*, s.pills_per_bottle, s.price, s.current_inventory, s.unit, s.drops_per_ml
     FROM regimens r JOIN supplements s ON s.id = r.supplement_id
     WHERE r.session_id=$1`,
    [req.params.sessionId]
  );

  const results = await Promise.all(regimens.map(async (regimen) => {
    const { rows: phases } = await pool.query(
      'SELECT * FROM phases WHERE regimen_id=$1 ORDER BY sequence_order',
      [regimen.id]
    );
    const unit = regimen.unit || 'capsules';
    const drops_per_ml = Number(regimen.drops_per_ml) || 20;
    // For drops: pills_per_bottle is stored in ml — convert to drops for the calculator
    const pillsPerBottle = unit === 'drops'
      ? Number(regimen.pills_per_bottle) * drops_per_ml
      : Number(regimen.pills_per_bottle);
    const calc = calculate({
      phases,
      inventory: Number(regimen.current_inventory),
      startDate: session.start_date,
      targetDate: session.target_date,
      pillsPerBottle,
      pricePerBottle: regimen.price,
    });
    return { regimen_id: regimen.id, unit, drops_per_ml, ...calc };
  }));

  res.json({ session, results });
}));

// ── Backup / Restore ──────────────────────────────────────────────────────────
app.get('/backup', w(async (req, res) => {
  const { rows: supplements } = await pool.query('SELECT * FROM supplements');
  const { rows: sessions } = await pool.query('SELECT * FROM sessions');
  const { rows: regimens } = await pool.query('SELECT * FROM regimens');
  const { rows: phases } = await pool.query('SELECT * FROM phases');
  res.json({ version: 1, exported_at: new Date().toISOString(), supplements, sessions, regimens, phases });
}));

app.post('/restore', w(async (req, res) => {
  const { supplements = [], sessions = [], regimens = [], phases = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE supplements, sessions CASCADE');
    for (const s of supplements)
      await client.query(
        'INSERT INTO supplements (id,name,brand,pills_per_bottle,price,type,current_inventory,unit,drops_per_ml) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [s.id, s.name, s.brand, s.pills_per_bottle, s.price, s.type, s.current_inventory, s.unit || 'capsules', s.drops_per_ml ?? 20]
      );
    for (const s of sessions)
      await client.query(
        'INSERT INTO sessions (id,start_date,target_date,notes) VALUES ($1,$2,$3,$4)',
        [s.id, s.start_date, s.target_date, s.notes]
      );
    for (const r of regimens)
      await client.query(
        'INSERT INTO regimens (id,session_id,supplement_id,notes) VALUES ($1,$2,$3,$4)',
        [r.id, r.session_id, r.supplement_id, r.notes]
      );
    for (const p of phases)
      await client.query(
        'INSERT INTO phases (id,regimen_id,dosage,duration_days,days_of_week,indefinite,sequence_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [p.id, p.regimen_id, p.dosage, p.duration_days, p.days_of_week, p.indefinite, p.sequence_order]
      );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

app.delete('/data', w(async (req, res) => {
  await pool.query('TRUNCATE supplements, sessions CASCADE');
  res.json({ ok: true });
}));

// ── Push Notifications ────────────────────────────────────────────────────────
app.get('/push/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

app.post('/push/subscribe', w(async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
     VALUES ($1,$2,$3) ON CONFLICT (endpoint) DO UPDATE SET p256dh=$2, auth=$3`,
    [endpoint, keys.p256dh, keys.auth]
  );
  res.json({ ok: true });
}));

app.delete('/push/subscribe', w(async (req, res) => {
  const { endpoint } = req.body;
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
  res.json({ ok: true });
}));

app.post('/push/test', w(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM push_subscriptions');
  if (!rows.length) return res.status(404).json({ error: 'No subscriptions' });
  const payload = JSON.stringify({ title: 'PillPipe Test', body: 'Notifications are working!' });
  await Promise.allSettled(rows.map(sub =>
    webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
      .catch(async (err) => {
        if (err.statusCode === 410) await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint]);
      })
  ));
  res.json({ ok: true, sent: rows.length });
}));

// ── Reminder times ────────────────────────────────────────────────────────────
app.patch('/regimens/:id/reminder', w(async (req, res) => {
  const { reminder_time } = req.body; // HH:MM or null
  const { rows } = await pool.query(
    'UPDATE regimens SET reminder_time=$1 WHERE id=$2 RETURNING *',
    [reminder_time || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
}));

// ── Dose Log ──────────────────────────────────────────────────────────────────
app.post('/dose-log', w(async (req, res) => {
  const { regimen_id, date, status } = req.body; // status: 'taken' | 'skipped'
  const { rows } = await pool.query(
    `INSERT INTO dose_log (regimen_id, date, status)
     VALUES ($1,$2,$3)
     ON CONFLICT (regimen_id, date) DO UPDATE SET status=$3, logged_at=NOW()
     RETURNING *`,
    [regimen_id, date, status]
  );
  res.json(rows[0]);
}));

app.get('/dose-log', w(async (req, res) => {
  const { regimen_id, since } = req.query;
  let q = 'SELECT * FROM dose_log WHERE 1=1';
  const params = [];
  if (regimen_id) { params.push(regimen_id); q += ` AND regimen_id=$${params.length}`; }
  if (since)      { params.push(since);      q += ` AND date >= $${params.length}`; }
  q += ' ORDER BY date DESC LIMIT 90';
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup migrations ────────────────────────────────────────────────────────
pool.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS notes TEXT').catch(console.error);
pool.query('ALTER TABLE phases ADD COLUMN IF NOT EXISTS indefinite BOOLEAN DEFAULT FALSE').catch(console.error);
pool.query('ALTER TABLE regimens ADD COLUMN IF NOT EXISTS notes TEXT').catch(console.error);
pool.query("ALTER TABLE supplements ADD COLUMN IF NOT EXISTS unit VARCHAR(10) DEFAULT 'capsules'").catch(console.error);
pool.query('ALTER TABLE supplements ADD COLUMN IF NOT EXISTS drops_per_ml NUMERIC DEFAULT 20').catch(console.error);
pool.query('ALTER TABLE supplements ALTER COLUMN pills_per_bottle TYPE NUMERIC').catch(console.error);
pool.query('ALTER TABLE supplements ALTER COLUMN current_inventory TYPE NUMERIC').catch(console.error);
pool.query('ALTER TABLE phases ALTER COLUMN dosage TYPE NUMERIC').catch(console.error);
pool.query('ALTER TABLE regimens ADD COLUMN IF NOT EXISTS reminder_time TIME').catch(console.error);
pool.query(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint  TEXT UNIQUE NOT NULL,
    p256dh    TEXT NOT NULL,
    auth      TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(console.error);
pool.query(`
  CREATE TABLE IF NOT EXISTS dose_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    regimen_id  UUID NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('taken','skipped')),
    logged_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (regimen_id, date)
  )
`).catch(console.error);

// ── Notification cron (runs every minute) ─────────────────────────────────────
cron.schedule('* * * * *', async () => {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const today = now.toISOString().slice(0, 10);

    // Find regimens with reminder_time == now, belonging to an active session
    const { rows: regimens } = await pool.query(`
      SELECT r.id, r.reminder_time, s.name AS supplement_name, s.unit, s.drops_per_ml,
             sess.start_date, sess.target_date
      FROM regimens r
      JOIN supplements s ON s.id = r.supplement_id
      JOIN sessions sess ON sess.id = r.session_id
      WHERE r.reminder_time IS NOT NULL
        AND to_char(r.reminder_time, 'HH24:MI') = $1
        AND sess.start_date <= CURRENT_DATE
        AND sess.target_date >= CURRENT_DATE
    `, [hhmm]);

    if (!regimens.length) return;

    const { rows: subs } = await pool.query('SELECT * FROM push_subscriptions');
    if (!subs.length) return;

    for (const r of regimens) {
      const payload = JSON.stringify({
        title: `Time to take ${r.supplement_name}`,
        body: `Your ${r.supplement_name} reminder`,
        tag: `dose-${r.id}-${today}`,
        url: '/',
      });
      await Promise.allSettled(subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(async (err) => {
          if (err.statusCode === 410) await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint]);
        })
      ));
    }
  } catch (e) {
    console.error('Cron notification error:', e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PillPipe API v${version} running on port ${PORT}`));
