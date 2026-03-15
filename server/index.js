const express = require('express');
const pool = require('./db');
const { calculate } = require('./calculator');

const app = express();
app.use(express.json());

const w = fn => (req, res, next) => fn(req, res, next).catch(next);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Supplements ───────────────────────────────────────────────────────────────
app.get('/supplements', w(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM supplements ORDER BY name');
  res.json(rows);
}));

app.post('/supplements', w(async (req, res) => {
  const { name, brand, pills_per_bottle, price, type, current_inventory } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO supplements (name, brand, pills_per_bottle, price, type, current_inventory)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, brand, pills_per_bottle, price, type, current_inventory ?? 0]
  );
  res.status(201).json(rows[0]);
}));

app.put('/supplements/:id', w(async (req, res) => {
  const { name, brand, pills_per_bottle, price, type, current_inventory } = req.body;
  const { rows } = await pool.query(
    `UPDATE supplements SET name=$1, brand=$2, pills_per_bottle=$3, price=$4, type=$5, current_inventory=$6
     WHERE id=$7 RETURNING *`,
    [name, brand, pills_per_bottle, price, type, current_inventory ?? 0, req.params.id]
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
    `SELECT r.*, s.name AS supplement_name, s.brand, s.pills_per_bottle, s.price, s.type, s.current_inventory
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
    `SELECT r.*, s.pills_per_bottle, s.price, s.current_inventory
     FROM regimens r JOIN supplements s ON s.id = r.supplement_id
     WHERE r.session_id=$1`,
    [req.params.sessionId]
  );

  const results = await Promise.all(regimens.map(async (regimen) => {
    const { rows: phases } = await pool.query(
      'SELECT * FROM phases WHERE regimen_id=$1 ORDER BY sequence_order',
      [regimen.id]
    );
    const calc = calculate({
      phases,
      inventory: regimen.current_inventory,
      startDate: session.start_date,
      targetDate: session.target_date,
      pillsPerBottle: regimen.pills_per_bottle,
      pricePerBottle: regimen.price,
    });
    return { regimen_id: regimen.id, ...calc };
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
        'INSERT INTO supplements (id,name,brand,pills_per_bottle,price,type,current_inventory) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [s.id, s.name, s.brand, s.pills_per_bottle, s.price, s.type, s.current_inventory]
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

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup migrations ────────────────────────────────────────────────────────
pool.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS notes TEXT').catch(console.error);
pool.query('ALTER TABLE phases ADD COLUMN IF NOT EXISTS indefinite BOOLEAN DEFAULT FALSE').catch(console.error);
pool.query('ALTER TABLE regimens ADD COLUMN IF NOT EXISTS notes TEXT').catch(console.error);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PillPipe API running on port ${PORT}`));
