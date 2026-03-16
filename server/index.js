const express = require('express');
const cron = require('node-cron');
const webpush = require('web-push');
const { google } = require('googleapis');
const { Readable } = require('stream');
const pool = require('./db');
const { calculate } = require('./calculator');
const { version } = require('./package.json');

// ── Google OAuth2 setup ───────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
// Auto-persist refreshed access tokens back to the DB
oauth2Client.on('tokens', async (tokens) => {
  try {
    if (tokens.refresh_token) {
      await pool.query(
        'UPDATE google_tokens SET access_token=$1, refresh_token=$2, expiry_date=$3, updated_at=NOW()',
        [tokens.access_token, tokens.refresh_token, tokens.expiry_date]
      );
    } else {
      await pool.query(
        'UPDATE google_tokens SET access_token=$1, expiry_date=$2, updated_at=NOW()',
        [tokens.access_token, tokens.expiry_date]
      );
    }
  } catch (e) { console.error('Token refresh persist error:', e.message); }
});

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

// ── Google Drive on-change backup middleware ──────────────────────────────────
app.use((req, res, next) => {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const excluded = ['/auth/', '/drive/', '/push/', '/dose-log', '/backup', '/restore', '/data', '/version', '/health'];
  if (mutating.includes(req.method) && !excluded.some(p => req.path.startsWith(p))) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        triggerDriveBackup('on_change').catch(e => console.error('Drive on-change:', e.message));
      }
    });
  }
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/version', (req, res) => res.json({ version }));

// ── Supplements ───────────────────────────────────────────────────────────────
app.get('/supplements', w(async (req, res) => {
  // Include computed days_remaining from the first active-session phase for each supplement
  const { rows } = await pool.query(`
    SELECT s.*,
      (
        SELECT FLOOR(s.current_inventory / NULLIF(p.dosage * (COALESCE(array_length(p.days_of_week, 1), 7) / 7.0), 0))
        FROM phases p
        JOIN regimens r ON r.id = p.regimen_id
        JOIN sessions sess ON sess.id = r.session_id
        WHERE r.supplement_id = s.id
          AND sess.start_date <= CURRENT_DATE
          AND sess.target_date >= CURRENT_DATE
        ORDER BY p.sequence_order
        LIMIT 1
      ) AS days_remaining
    FROM supplements s
    ORDER BY s.name
  `);
  res.json(rows);
}));

app.post('/supplements', w(async (req, res) => {
  const { name, brand, pills_per_bottle, price, type, current_inventory, unit, drops_per_ml, reorder_threshold, reorder_threshold_mode } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO supplements (name, brand, pills_per_bottle, price, type, current_inventory, unit, drops_per_ml, reorder_threshold, reorder_threshold_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [name, brand, pills_per_bottle, price, type, current_inventory ?? 0, unit || 'capsules', drops_per_ml ?? 20, reorder_threshold ?? null, reorder_threshold_mode || 'units']
  );
  res.status(201).json(rows[0]);
}));

app.put('/supplements/:id', w(async (req, res) => {
  const { name, brand, pills_per_bottle, price, type, current_inventory, unit, drops_per_ml, reorder_threshold, reorder_threshold_mode } = req.body;
  const { rows } = await pool.query(
    `UPDATE supplements SET name=$1, brand=$2, pills_per_bottle=$3, price=$4, type=$5, current_inventory=$6, unit=$7, drops_per_ml=$8, reorder_threshold=$9, reorder_threshold_mode=$10
     WHERE id=$11 RETURNING *`,
    [name, brand, pills_per_bottle, price, type, current_inventory ?? 0, unit || 'capsules', drops_per_ml ?? 20, reorder_threshold ?? null, reorder_threshold_mode || 'units', req.params.id]
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
  const { start_date, target_date, notes, template_id } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO sessions (start_date, target_date, notes) VALUES ($1,$2,$3) RETURNING *`,
    [start_date, target_date, notes || null]
  );
  const session = rows[0];
  if (template_id) {
    const { rows: tmplRegimens } = await pool.query(
      'SELECT * FROM template_regimens WHERE template_id=$1', [template_id]
    );
    for (const tr of tmplRegimens) {
      const { rows: [newRegimen] } = await pool.query(
        'INSERT INTO regimens (session_id, supplement_id) VALUES ($1,$2) RETURNING *',
        [session.id, tr.supplement_id]
      );
      const { rows: tmplPhases } = await pool.query(
        'SELECT * FROM template_phases WHERE template_regimen_id=$1 ORDER BY sequence_order', [tr.id]
      );
      for (const tp of tmplPhases) {
        await pool.query(
          'INSERT INTO phases (regimen_id, dosage, duration_days, days_of_week, sequence_order, indefinite) VALUES ($1,$2,$3,$4,$5,$6)',
          [newRegimen.id, tp.dosage, tp.duration_days, tp.days_of_week, tp.sequence_order, tp.indefinite]
        );
      }
    }
  }
  res.status(201).json(session);
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

// ── Templates ─────────────────────────────────────────────────────────────────
app.get('/templates', w(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM templates ORDER BY name');
  res.json(rows);
}));

app.post('/sessions/:id/save-as-template', w(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const { rows: [tmpl] } = await pool.query(
    'INSERT INTO templates (name) VALUES ($1) RETURNING *', [name.trim()]
  );
  const { rows: srcRegimens } = await pool.query(
    'SELECT * FROM regimens WHERE session_id=$1', [req.params.id]
  );
  for (const r of srcRegimens) {
    const { rows: [tr] } = await pool.query(
      'INSERT INTO template_regimens (template_id, supplement_id) VALUES ($1,$2) RETURNING *',
      [tmpl.id, r.supplement_id]
    );
    const { rows: srcPhases } = await pool.query(
      'SELECT * FROM phases WHERE regimen_id=$1 ORDER BY sequence_order', [r.id]
    );
    for (const p of srcPhases) {
      await pool.query(
        'INSERT INTO template_phases (template_regimen_id, dosage, duration_days, days_of_week, sequence_order, indefinite) VALUES ($1,$2,$3,$4,$5,$6)',
        [tr.id, p.dosage, p.duration_days, p.days_of_week, p.sequence_order, !!p.indefinite]
      );
    }
  }
  res.status(201).json(tmpl);
}));

app.delete('/templates/:id', w(async (req, res) => {
  await pool.query('DELETE FROM templates WHERE id=$1', [req.params.id]);
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
  const { rows: templates } = await pool.query('SELECT * FROM templates');
  const { rows: template_regimens } = await pool.query('SELECT * FROM template_regimens');
  const { rows: template_phases } = await pool.query('SELECT * FROM template_phases');
  res.json({ version: 1, exported_at: new Date().toISOString(), supplements, sessions, regimens, phases, templates, template_regimens, template_phases });
}));

app.post('/restore', w(async (req, res) => {
  const { supplements = [], sessions = [], regimens = [], phases = [], templates = [], template_regimens = [], template_phases = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE supplements, sessions, templates CASCADE');
    for (const s of supplements)
      await client.query(
        'INSERT INTO supplements (id,name,brand,pills_per_bottle,price,type,current_inventory,unit,drops_per_ml,reorder_threshold,reorder_threshold_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [s.id, s.name, s.brand, s.pills_per_bottle, s.price, s.type, s.current_inventory, s.unit || 'capsules', s.drops_per_ml ?? 20, s.reorder_threshold ?? null, s.reorder_threshold_mode || 'units']
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
    for (const t of templates)
      await client.query(
        'INSERT INTO templates (id,name,notes,created_at) VALUES ($1,$2,$3,$4)',
        [t.id, t.name, t.notes ?? null, t.created_at]
      );
    for (const tr of template_regimens)
      await client.query(
        'INSERT INTO template_regimens (id,template_id,supplement_id,created_at) VALUES ($1,$2,$3,$4)',
        [tr.id, tr.template_id, tr.supplement_id, tr.created_at]
      );
    for (const tp of template_phases)
      await client.query(
        'INSERT INTO template_phases (id,template_regimen_id,dosage,duration_days,days_of_week,indefinite,sequence_order,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [tp.id, tp.template_regimen_id, tp.dosage, tp.duration_days, tp.days_of_week, tp.indefinite, tp.sequence_order, tp.created_at]
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

// ── Google OAuth ──────────────────────────────────────────────────────────────
app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google not configured' });
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    prompt: 'consent', // always get refresh token
  });
  res.redirect(url);
});

app.get('/auth/google/callback', w(async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?drive=error');
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data: userInfo } = await oauth2.userinfo.get();
  await pool.query('DELETE FROM google_tokens');
  await pool.query(
    'INSERT INTO google_tokens (access_token, refresh_token, expiry_date, email) VALUES ($1,$2,$3,$4)',
    [tokens.access_token, tokens.refresh_token, tokens.expiry_date, userInfo.email]
  );
  res.redirect('/?drive=connected');
}));

app.delete('/auth/google', w(async (req, res) => {
  await pool.query('DELETE FROM google_tokens');
  res.json({ ok: true });
}));

// ── Google Drive Backup ───────────────────────────────────────────────────────
app.get('/drive/status', w(async (req, res) => {
  const { rows: tok } = await pool.query('SELECT email FROM google_tokens LIMIT 1');
  const { rows: cfg } = await pool.query('SELECT * FROM google_drive_settings LIMIT 1');
  res.json({
    connected: tok.length > 0,
    email: tok[0]?.email || null,
    frequency: cfg[0]?.frequency || 'manual',
    last_backup_at: cfg[0]?.last_backup_at || null,
  });
}));

app.patch('/drive/settings', w(async (req, res) => {
  const { frequency } = req.body;
  if (!['manual', 'daily', 'on_change'].includes(frequency))
    return res.status(400).json({ error: 'Invalid frequency' });
  await pool.query(`
    INSERT INTO google_drive_settings (singleton, frequency)
    VALUES (TRUE, $1)
    ON CONFLICT (singleton) DO UPDATE SET frequency=$1, updated_at=NOW()
  `, [frequency]);
  res.json({ ok: true, frequency });
}));

app.post('/drive/backup', w(async (req, res) => {
  const result = await driveBackup();
  if (!result) return res.status(400).json({ error: 'Not connected to Google Drive' });
  res.json({ ok: true, file: result });
}));

app.get('/drive/backups', w(async (req, res) => {
  const drive = await getDriveClient();
  if (!drive) return res.json({ files: [] });
  const folderRes = await drive.files.list({
    q: "name='PillPipe' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id)',
  });
  if (!folderRes.data.files.length) return res.json({ files: [] });
  const folderId = folderRes.data.files[0].id;
  const filesRes = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,createdTime,size)',
    orderBy: 'createdTime desc',
    pageSize: 20,
  });
  res.json({ files: filesRes.data.files });
}));

app.post('/drive/restore/:fileId', w(async (req, res) => {
  const drive = await getDriveClient();
  if (!drive) return res.status(400).json({ error: 'Not connected to Google Drive' });
  const response = await drive.files.get(
    { fileId: req.params.fileId, alt: 'media' },
    { responseType: 'text' }
  );
  const { supplements=[], sessions=[], regimens=[], phases=[], templates=[], template_regimens=[], template_phases=[] } = JSON.parse(response.data);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE supplements, sessions, templates CASCADE');
    for (const s of supplements)
      await client.query('INSERT INTO supplements (id,name,brand,pills_per_bottle,price,type,current_inventory,unit,drops_per_ml,reorder_threshold,reorder_threshold_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [s.id, s.name, s.brand, s.pills_per_bottle, s.price, s.type, s.current_inventory, s.unit||'capsules', s.drops_per_ml??20, s.reorder_threshold??null, s.reorder_threshold_mode||'units']);
    for (const s of sessions)
      await client.query('INSERT INTO sessions (id,start_date,target_date,notes) VALUES ($1,$2,$3,$4)', [s.id, s.start_date, s.target_date, s.notes]);
    for (const r of regimens)
      await client.query('INSERT INTO regimens (id,session_id,supplement_id,notes) VALUES ($1,$2,$3,$4)', [r.id, r.session_id, r.supplement_id, r.notes]);
    for (const p of phases)
      await client.query('INSERT INTO phases (id,regimen_id,dosage,duration_days,days_of_week,indefinite,sequence_order) VALUES ($1,$2,$3,$4,$5,$6,$7)', [p.id, p.regimen_id, p.dosage, p.duration_days, p.days_of_week, p.indefinite, p.sequence_order]);
    for (const t of templates)
      await client.query('INSERT INTO templates (id,name,notes,created_at) VALUES ($1,$2,$3,$4)', [t.id, t.name, t.notes??null, t.created_at]);
    for (const tr of template_regimens)
      await client.query('INSERT INTO template_regimens (id,template_id,supplement_id,created_at) VALUES ($1,$2,$3,$4)', [tr.id, tr.template_id, tr.supplement_id, tr.created_at]);
    for (const tp of template_phases)
      await client.query('INSERT INTO template_phases (id,template_regimen_id,dosage,duration_days,days_of_week,indefinite,sequence_order,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [tp.id, tp.template_regimen_id, tp.dosage, tp.duration_days, tp.days_of_week, tp.indefinite, tp.sequence_order, tp.created_at]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
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

// ── Low-stock alert endpoint (manual trigger) ─────────────────────────────────
app.post('/push/low-stock-check', w(async (req, res) => {
  await checkLowStock();
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
pool.query("ALTER TABLE supplements ADD COLUMN IF NOT EXISTS unit VARCHAR(10) DEFAULT 'capsules'").catch(console.error);
pool.query('ALTER TABLE supplements ADD COLUMN IF NOT EXISTS drops_per_ml NUMERIC DEFAULT 20').catch(console.error);
pool.query('ALTER TABLE supplements ADD COLUMN IF NOT EXISTS reorder_threshold NUMERIC').catch(console.error);
pool.query("ALTER TABLE supplements ADD COLUMN IF NOT EXISTS reorder_threshold_mode VARCHAR(10) DEFAULT 'units'").catch(console.error);
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
// Template tables must be created in order (FK chain: templates → template_regimens → template_phases)
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      notes      TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_regimens (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id   UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      supplement_id UUID NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_phases (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_regimen_id  UUID NOT NULL REFERENCES template_regimens(id) ON DELETE CASCADE,
      dosage               NUMERIC NOT NULL,
      duration_days        INTEGER NOT NULL,
      days_of_week         INTEGER[],
      indefinite           BOOLEAN NOT NULL DEFAULT FALSE,
      sequence_order       INTEGER NOT NULL,
      created_at           TIMESTAMPTZ DEFAULT NOW()
    )
  `);
})().catch(console.error);

// ── Google Drive helpers ──────────────────────────────────────────────────────
async function getDriveClient() {
  const { rows } = await pool.query('SELECT * FROM google_tokens LIMIT 1');
  if (!rows.length) return null;
  const tok = rows[0];
  oauth2Client.setCredentials({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expiry_date: tok.expiry_date ? Number(tok.expiry_date) : null,
  });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function driveBackup() {
  const drive = await getDriveClient();
  if (!drive) return null;

  // Get or create PillPipe folder
  let folderId;
  const folderRes = await drive.files.list({
    q: "name='PillPipe' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id)',
  });
  if (folderRes.data.files.length) {
    folderId = folderRes.data.files[0].id;
  } else {
    const created = await drive.files.create({
      requestBody: { name: 'PillPipe', mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    folderId = created.data.id;
  }

  // Build backup payload
  const [supp, sess, reg, ph, tmpl, tr, tp] = await Promise.all([
    pool.query('SELECT * FROM supplements'),
    pool.query('SELECT * FROM sessions'),
    pool.query('SELECT * FROM regimens'),
    pool.query('SELECT * FROM phases'),
    pool.query('SELECT * FROM templates'),
    pool.query('SELECT * FROM template_regimens'),
    pool.query('SELECT * FROM template_phases'),
  ]);
  const payload = JSON.stringify({
    version: 1, exported_at: new Date().toISOString(),
    supplements: supp.rows, sessions: sess.rows, regimens: reg.rows, phases: ph.rows,
    templates: tmpl.rows, template_regimens: tr.rows, template_phases: tp.rows,
  });

  const filename = `pillpipe-backup-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
  const file = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: 'application/json', body: Readable.from([payload]) },
    fields: 'id,name,createdTime',
  });

  await pool.query(`
    INSERT INTO google_drive_settings (singleton, last_backup_at, last_backup_file_id)
    VALUES (TRUE, NOW(), $1)
    ON CONFLICT (singleton) DO UPDATE SET last_backup_at=NOW(), last_backup_file_id=$1, updated_at=NOW()
  `, [file.data.id]);

  return file.data;
}

async function triggerDriveBackup(requiredMode) {
  const { rows } = await pool.query('SELECT frequency FROM google_drive_settings LIMIT 1');
  if (!rows.length || rows[0].frequency !== requiredMode) return;
  await driveBackup();
}

// ── Low-stock check helper ────────────────────────────────────────────────────
async function checkLowStock() {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const { rows: candidates } = await pool.query(
    'SELECT * FROM supplements WHERE reorder_threshold IS NOT NULL'
  );
  if (!candidates.length) return;
  const { rows: subs } = await pool.query('SELECT * FROM push_subscriptions');
  if (!subs.length) return;

  for (const supp of candidates) {
    const unit = supp.unit || 'capsules';
    const dpm = Number(supp.drops_per_ml) || 20;
    const inv = Number(supp.current_inventory);
    const threshold = Number(supp.reorder_threshold);
    const mode = supp.reorder_threshold_mode || 'units';

    // Get dosage from active session phase (needed for days mode + notification body)
    const { rows: phases } = await pool.query(`
      SELECT p.dosage, p.days_of_week
      FROM phases p
      JOIN regimens r ON r.id = p.regimen_id
      JOIN sessions s ON s.id = r.session_id
      WHERE r.supplement_id = $1
        AND s.start_date <= CURRENT_DATE
        AND s.target_date >= CURRENT_DATE
      ORDER BY p.sequence_order
      LIMIT 1
    `, [supp.id]);

    let daysRemaining = null;
    if (phases.length) {
      const dosage = Number(phases[0].dosage);
      const dow = phases[0].days_of_week;
      const daysPerWeek = dow ? dow.length : 7;
      const dailyDose = dosage * (daysPerWeek / 7);
      if (dailyDose > 0) daysRemaining = Math.floor(inv / dailyDose);
    }

    // Check threshold against the chosen mode
    const isLow = mode === 'days'
      ? (daysRemaining !== null && daysRemaining <= threshold)
      : (inv <= threshold);
    if (!isLow) continue;

    // Build notification body
    let invStr;
    if (unit === 'drops') invStr = `${inv} drops (~${(inv / dpm).toFixed(1)} ml)`;
    else if (unit === 'ml') invStr = `${inv} ml`;
    else if (unit === 'tablets') invStr = `${inv} tab${inv !== 1 ? 's' : ''}`;
    else invStr = `${inv} cap${inv !== 1 ? 's' : ''}`;

    const daysStr = daysRemaining !== null
      ? ` · ~${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`
      : '';

    const payload = JSON.stringify({
      title: `⚠️ Low stock: ${supp.name}`,
      body: `${invStr} on hand${daysStr}`,
      tag: `low-stock-${supp.id}`,
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
}

// ── Google Drive table migrations ─────────────────────────────────────────────
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expiry_date   BIGINT,
      email         TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_drive_settings (
      singleton            BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      frequency            TEXT NOT NULL DEFAULT 'manual',
      last_backup_at       TIMESTAMPTZ,
      last_backup_file_id  TEXT,
      updated_at           TIMESTAMPTZ DEFAULT NOW()
    )
  `);
})().catch(console.error);

// ── Daily Google Drive backup cron (runs at 2am) ──────────────────────────────
cron.schedule('0 2 * * *', () => triggerDriveBackup('daily').catch(e => console.error('Drive daily backup error:', e.message)));

// ── Daily low-stock cron (runs at 8am every day) ──────────────────────────────
cron.schedule('0 8 * * *', () => checkLowStock().catch(e => console.error('Low-stock cron error:', e.message)));

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
