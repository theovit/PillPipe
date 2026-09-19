const express = require('express');
const cron = require('node-cron');
const webpush = require('web-push');
const { google } = require('googleapis');
const { Readable } = require('stream');
const pool = require('./db');
const { calculate } = require('./calculator');
const { version } = require('./package.json');
const auth = require('./auth');
const { validatePhaseBody, normalizePhaseRow, supplementDaysRemaining, activePhase, dayIndex } = require('./dosing');
const { buildBackup, isValidBackup, restoreBackup } = require('./backup');
const { nowInTz } = require('./tz');

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
app.disable('x-powered-by');
// One trusted proxy hop (nginx in production). Never `true`: that trusts a client-supplied XFF.
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'no-store');
  next();
});
// Order matters: flood limit -> CSRF -> auth gate -> everything else. Keep the gate before any
// body parsing or route so every route needs a session unless allowlisted in auth.js.
app.use(auth.apiLimiter);
app.use(auth.csrf);
app.use(auth.gate);
app.use(auth.router);
// /restore has its own (larger) parser, mounted after auth on the route itself.
const jsonBody = express.json();
app.use((req, res, next) => (req.path === '/restore' ? next() : jsonBody(req, res, next)));

const w = fn => (req, res, next) => fn(req, res, next).catch(next);

// ── Google Drive on-change backup middleware ──────────────────────────────────
app.use((req, res, next) => {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const excluded = ['/auth/', '/drive/', '/push/', '/dose-log', '/backup', '/restore', '/data', '/version', '/health', '/settings/'];
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
// The owner's timezone (prefs.timezone) decides what "today" is; the server clock is UTC.
async function userTimezone() {
  const { rows } = await pool.query("SELECT prefs->>'timezone' AS tz FROM user_settings WHERE singleton = TRUE");
  return rows[0]?.tz ?? null;
}

// Map supplement_id -> [currently active phase of every non-as-needed regimen using it today].
async function activePhasesBySupplement(todayStr) {
  const [sessions, regimens, phases] = await Promise.all([
    pool.query("SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(target_date, 'YYYY-MM-DD') AS target_date FROM sessions"),
    pool.query('SELECT id, session_id, supplement_id FROM regimens WHERE as_needed = FALSE'),
    pool.query('SELECT * FROM phases'),
  ]);
  const sessionById = new Map(sessions.rows.map(s => [s.id, s]));
  const phasesByRegimen = new Map();
  for (const ph of phases.rows) {
    if (!phasesByRegimen.has(ph.regimen_id)) phasesByRegimen.set(ph.regimen_id, []);
    phasesByRegimen.get(ph.regimen_id).push(ph);
  }
  const active = new Map();
  for (const r of regimens.rows) {
    const s = sessionById.get(r.session_id);
    if (!s) continue;
    const current = activePhase(phasesByRegimen.get(r.id) ?? [], s.start_date, todayStr, dayIndex(s.start_date, s.target_date));
    if (!current) continue;
    if (!active.has(r.supplement_id)) active.set(r.supplement_id, []);
    active.get(r.supplement_id).push(current.phase);
  }
  return active;
}

// Copies a phase's schedule onto a regimen / template regimen from a row of any vintage.
function insertPhaseCopy(regimenId, p) {
  const d = normalizePhaseRow(p);
  return pool.query(
    `INSERT INTO phases (regimen_id, dose_morning, dose_lunch, dose_dinner, custom_slots, duration_days, days_of_week, indefinite, sequence_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [regimenId, d.dose_morning, d.dose_lunch, d.dose_dinner, JSON.stringify(d.custom_slots), p.duration_days, p.days_of_week ?? null, !!p.indefinite, p.sequence_order]
  );
}

function insertTemplatePhaseCopy(templateRegimenId, p) {
  const d = normalizePhaseRow(p);
  return pool.query(
    `INSERT INTO template_phases (template_regimen_id, dose_morning, dose_lunch, dose_dinner, custom_slots, duration_days, days_of_week, indefinite, sequence_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [templateRegimenId, d.dose_morning, d.dose_lunch, d.dose_dinner, JSON.stringify(d.custom_slots), p.duration_days, p.days_of_week ?? null, !!p.indefinite, p.sequence_order]
  );
}

app.get('/supplements', w(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM supplements ORDER BY name');
  const active = await activePhasesBySupplement(nowInTz(await userTimezone()).date);
  // days_remaining: supply left at the current active-phase rate across every active regimen (null = none scheduled)
  res.json(rows.map(s => ({ ...s, days_remaining: supplementDaysRemaining(s.current_inventory, active.get(s.id) ?? []) })));
}));

app.post('/supplements', w(async (req, res) => {
  const { name, brand, pills_per_bottle, price, type, current_inventory, unit, drops_per_ml, reorder_threshold, reorder_threshold_mode, take_with_food } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO supplements (name, brand, pills_per_bottle, price, type, current_inventory, unit, drops_per_ml, reorder_threshold, reorder_threshold_mode, take_with_food)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [name, brand, pills_per_bottle, price, type, current_inventory ?? 0, unit || 'capsules', drops_per_ml ?? 20, reorder_threshold ?? null, reorder_threshold_mode || 'units', !!take_with_food]
  );
  res.status(201).json(rows[0]);
}));

app.put('/supplements/:id', w(async (req, res) => {
  const { name, brand, pills_per_bottle, price, type, current_inventory, unit, drops_per_ml, reorder_threshold, reorder_threshold_mode, take_with_food } = req.body;
  // take_with_food is only changed when sent, so an older client's edit can't silently reset it.
  const { rows } = await pool.query(
    `UPDATE supplements SET name=$1, brand=$2, pills_per_bottle=$3, price=$4, type=$5, current_inventory=$6, unit=$7, drops_per_ml=$8, reorder_threshold=$9, reorder_threshold_mode=$10,
       take_with_food=COALESCE($11, take_with_food)
     WHERE id=$12 RETURNING *`,
    [name, brand, pills_per_bottle, price, type, current_inventory ?? 0, unit || 'capsules', drops_per_ml ?? 20, reorder_threshold ?? null, reorder_threshold_mode || 'units',
      typeof take_with_food === 'boolean' ? take_with_food : null, req.params.id]
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
        'INSERT INTO regimens (session_id, supplement_id, as_needed) VALUES ($1,$2,$3) RETURNING *',
        [session.id, tr.supplement_id, !!tr.as_needed]
      );
      const { rows: tmplPhases } = await pool.query(
        'SELECT * FROM template_phases WHERE template_regimen_id=$1 ORDER BY sequence_order', [tr.id]
      );
      for (const tp of tmplPhases) {
        await insertPhaseCopy(newRegimen.id, tp);
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
      'INSERT INTO regimens (session_id, supplement_id, as_needed) VALUES ($1,$2,$3) RETURNING *',
      [newSession.id, r.supplement_id, !!r.as_needed]
    );
    const { rows: srcPhases } = await pool.query(
      'SELECT * FROM phases WHERE regimen_id=$1 ORDER BY sequence_order', [r.id]
    );
    for (const p of srcPhases) {
      await insertPhaseCopy(newRegimen.id, p);
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
      'INSERT INTO template_regimens (template_id, supplement_id, as_needed) VALUES ($1,$2,$3) RETURNING *',
      [tmpl.id, r.supplement_id, !!r.as_needed]
    );
    const { rows: srcPhases } = await pool.query(
      'SELECT * FROM phases WHERE regimen_id=$1 ORDER BY sequence_order', [r.id]
    );
    for (const p of srcPhases) {
      await insertTemplatePhaseCopy(tr.id, p);
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
    `SELECT r.*, s.name AS supplement_name, s.brand, s.pills_per_bottle, s.price, s.type, s.current_inventory, s.unit, s.drops_per_ml, s.take_with_food
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
  // Partial update: only the fields present in the body change (notes used to be wiped by any PATCH).
  const { notes, as_needed } = req.body;
  const { rows } = await pool.query(
    `UPDATE regimens SET notes = CASE WHEN $1::boolean THEN $2 ELSE notes END, as_needed = COALESCE($3, as_needed)
     WHERE id=$4 RETURNING *`,
    [Object.prototype.hasOwnProperty.call(req.body, 'notes'), notes || null, typeof as_needed === 'boolean' ? as_needed : null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
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
  const v = validatePhaseBody(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const p = v.value;
  // sequence_order is assigned here (client-side length+1 collided with UNIQUE(regimen_id, sequence_order)
  // after a middle phase was deleted).
  const { rows } = await pool.query(
    `INSERT INTO phases (regimen_id, dose_morning, dose_lunch, dose_dinner, custom_slots, duration_days, days_of_week, indefinite, sequence_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(MAX(sequence_order), 0) + 1 FROM phases WHERE regimen_id = $1))
     RETURNING *`,
    [req.params.regimenId, p.dose_morning, p.dose_lunch, p.dose_dinner, JSON.stringify(p.custom_slots), p.duration_days, p.days_of_week, p.indefinite]
  );
  res.status(201).json(rows[0]);
}));

app.put('/phases/:id', w(async (req, res) => {
  const v = validatePhaseBody(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const p = v.value;
  const { rows } = await pool.query(
    `UPDATE phases SET dose_morning=$1, dose_lunch=$2, dose_dinner=$3, custom_slots=$4, duration_days=$5, days_of_week=$6, indefinite=$7
     WHERE id=$8 RETURNING *`,
    [p.dose_morning, p.dose_lunch, p.dose_dinner, JSON.stringify(p.custom_slots), p.duration_days, p.days_of_week, p.indefinite, req.params.id]
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
     WHERE r.session_id=$1 AND r.as_needed = FALSE`,
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
  res.json(await buildBackup());
}));

app.post('/restore', express.json({ limit: '25mb' }), w(async (req, res) => {
  if (!isValidBackup(req.body)) return res.status(400).json({ error: 'Invalid backup file' });
  const prefs = await restoreBackup(req.body);
  res.json({ ok: true, prefs });
}));

app.delete('/data', w(async (req, res) => {
  await pool.query('TRUNCATE supplements, sessions CASCADE');
  res.json({ ok: true });
}));

// ── User Settings (prefs) ─────────────────────────────────────────────────────
app.get('/settings/prefs', w(async (req, res) => {
  const { rows } = await pool.query('SELECT prefs FROM user_settings WHERE singleton = TRUE');
  res.json(rows[0]?.prefs ?? {});
}));

app.put('/settings/prefs', w(async (req, res) => {
  const prefs = req.body;
  await pool.query(`
    INSERT INTO user_settings (singleton, prefs, updated_at)
    VALUES (TRUE, $1, NOW())
    ON CONFLICT (singleton) DO UPDATE SET prefs = $1, updated_at = NOW()
  `, [prefs]);
  res.json({ ok: true });
}));

// ── Google OAuth ──────────────────────────────────────────────────────────────
app.get('/auth/google', w(async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google not configured' });
  const url = oauth2Client.generateAuthUrl({
    // `state` binds the callback to this session so a forged callback can't link someone else's Drive.
    state: await auth.issueOAuthState(req.authSession.id),
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    prompt: 'consent', // always get refresh token
  });
  res.redirect(url);
}));

app.get('/auth/google/callback', w(async (req, res) => {
  const { code, error, state } = req.query;
  // Consume the state first (single use) — any mismatch, error or missing code ends here.
  if (!(await auth.consumeOAuthState(req.authSession.id, state)) || error || typeof code !== 'string' || !code) {
    return res.redirect('/?drive=error');
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    await pool.query('DELETE FROM google_tokens');
    await pool.query(
      'INSERT INTO google_tokens (access_token, refresh_token, expiry_date, email) VALUES ($1,$2,$3,$4)',
      [tokens.access_token, tokens.refresh_token, tokens.expiry_date, userInfo.email]
    );
  } catch (e) {
    console.error('Google OAuth callback failed:', e.message);
    return res.redirect('/?drive=error');
  }
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
  const parsed = JSON.parse(response.data);
  if (!isValidBackup(parsed)) return res.status(400).json({ error: 'Invalid backup file' });
  const prefs = await restoreBackup(parsed);
  res.json({ ok: true, prefs });
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
  // Body-parser style client errors (malformed JSON, too large) carry a 4xx status.
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Bad request' });
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup migrations ────────────────────────────────────────────────────────
// One sequential, awaited migration: statements depend on each other (template tables before their
// ALTERs, new columns before the dosage copy) and the server must not listen until it succeeds.
async function migrate() {
  const q = sql => pool.query(sql);
  await q('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS notes TEXT');
  await q('ALTER TABLE phases ADD COLUMN IF NOT EXISTS indefinite BOOLEAN DEFAULT FALSE');
  await q('ALTER TABLE regimens ADD COLUMN IF NOT EXISTS notes TEXT');
  await q("ALTER TABLE supplements ADD COLUMN IF NOT EXISTS unit VARCHAR(10) DEFAULT 'capsules'");
  await q('ALTER TABLE supplements ADD COLUMN IF NOT EXISTS drops_per_ml NUMERIC DEFAULT 20');
  await q('ALTER TABLE supplements ADD COLUMN IF NOT EXISTS reorder_threshold NUMERIC');
  await q("ALTER TABLE supplements ADD COLUMN IF NOT EXISTS reorder_threshold_mode VARCHAR(10) DEFAULT 'units'");
  await q('ALTER TABLE supplements ALTER COLUMN pills_per_bottle TYPE NUMERIC');
  await q('ALTER TABLE supplements ALTER COLUMN current_inventory TYPE NUMERIC');
  await q('ALTER TABLE phases ALTER COLUMN dosage TYPE NUMERIC');
  await q('ALTER TABLE regimens ADD COLUMN IF NOT EXISTS reminder_time TIME'); // legacy: unused since meal-time dosing
  await q(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint  TEXT UNIQUE NOT NULL,
      p256dh    TEXT NOT NULL,
      auth      TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS dose_log (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      regimen_id  UUID NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
      date        DATE NOT NULL,
      status      TEXT NOT NULL CHECK (status IN ('taken','skipped')),
      logged_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (regimen_id, date)
    )
  `);
  // Template tables must be created in order (FK chain: templates -> template_regimens -> template_phases)
  await q(`
    CREATE TABLE IF NOT EXISTS templates (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      notes      TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS template_regimens (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id   UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      supplement_id UUID NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await q(`
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

  // Meal-time dosing (docs/DECISIONS.md): daily dose = dose_morning + dose_lunch + dose_dinner +
  // sum(custom_slots[].amount). There is deliberately no dose_custom column (derived, not stored twice).
  await q('ALTER TABLE phases ADD COLUMN IF NOT EXISTS dose_morning NUMERIC NOT NULL DEFAULT 0');
  await q('ALTER TABLE phases ADD COLUMN IF NOT EXISTS dose_lunch NUMERIC NOT NULL DEFAULT 0');
  await q('ALTER TABLE phases ADD COLUMN IF NOT EXISTS dose_dinner NUMERIC NOT NULL DEFAULT 0');
  await q("ALTER TABLE phases ADD COLUMN IF NOT EXISTS custom_slots JSONB NOT NULL DEFAULT '[]'::jsonb");
  await q('ALTER TABLE phases ALTER COLUMN dosage SET DEFAULT 0');
  // Self-disabling copy of the legacy flat dose into breakfast; harmless on every boot.
  await q("UPDATE phases SET dose_morning = dosage, dosage = 0 WHERE dosage > 0 AND dose_morning = 0 AND dose_lunch = 0 AND dose_dinner = 0 AND custom_slots = '[]'::jsonb");
  await q('ALTER TABLE template_phases ADD COLUMN IF NOT EXISTS dose_morning NUMERIC NOT NULL DEFAULT 0');
  await q('ALTER TABLE template_phases ADD COLUMN IF NOT EXISTS dose_lunch NUMERIC NOT NULL DEFAULT 0');
  await q('ALTER TABLE template_phases ADD COLUMN IF NOT EXISTS dose_dinner NUMERIC NOT NULL DEFAULT 0');
  await q("ALTER TABLE template_phases ADD COLUMN IF NOT EXISTS custom_slots JSONB NOT NULL DEFAULT '[]'::jsonb");
  await q('ALTER TABLE template_phases ALTER COLUMN dosage SET DEFAULT 0');
  // Self-disabling copy of the legacy flat dose into breakfast; harmless on every boot.
  await q("UPDATE template_phases SET dose_morning = dosage, dosage = 0 WHERE dosage > 0 AND dose_morning = 0 AND dose_lunch = 0 AND dose_dinner = 0 AND custom_slots = '[]'::jsonb");
  await q('ALTER TABLE supplements ADD COLUMN IF NOT EXISTS take_with_food BOOLEAN NOT NULL DEFAULT FALSE');
  await q('ALTER TABLE regimens ADD COLUMN IF NOT EXISTS as_needed BOOLEAN NOT NULL DEFAULT FALSE');
  await q('ALTER TABLE template_regimens ADD COLUMN IF NOT EXISTS as_needed BOOLEAN NOT NULL DEFAULT FALSE');

  // Google Drive + prefs tables
  await q(`
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
  await q(`
    CREATE TABLE IF NOT EXISTS google_drive_settings (
      singleton            BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      frequency            TEXT NOT NULL DEFAULT 'manual',
      last_backup_at       TIMESTAMPTZ,
      last_backup_file_id  TEXT,
      updated_at           TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS user_settings (
      singleton   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      prefs       JSONB NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

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

  const payload = JSON.stringify(await buildBackup());

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
  const active = await activePhasesBySupplement(nowInTz(await userTimezone()).date);

  for (const supp of candidates) {
    const unit = supp.unit || 'capsules';
    const dpm = Number(supp.drops_per_ml) || 20;
    const inv = Number(supp.current_inventory);
    const threshold = Number(supp.reorder_threshold);
    const mode = supp.reorder_threshold_mode || 'units';

    // Days of supply at the current active-phase rate (null when nothing is scheduled)
    const daysRemaining = supplementDaysRemaining(inv, active.get(supp.id) ?? []);

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

// ── Daily expired-session purge (runs at 3am) ─────────────────────────────────
cron.schedule('0 3 * * *', () => auth.purgeExpired().catch(e => console.error('Session purge error:', e.message)));

const PORT = process.env.PORT || 3000;
// Do not listen until the auth schema exists and the password hash is valid (fail closed).
auth.init()
  .then(migrate)
  .then(() => app.listen(PORT, () => console.log(`PillPipe API v${version} running on port ${PORT}`)))
  .catch(e => { console.error(e.message); process.exit(1); });
