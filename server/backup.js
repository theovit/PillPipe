// Backup export / restore, shared by GET /backup, POST /restore, the Google Drive backup and
// POST /drive/restore. Version 2 adds the meal-time dosing fields (dose_morning/lunch/dinner,
// custom_slots), take_with_food and as_needed. Version 1 files (flat `dosage`) and files without a
// version still restore: their dose is mapped into dose_morning. Any other version is rejected — a
// newer file restored by an older server would otherwise silently zero every dose.
const pool = require('./db');
const { normalizePhaseRow } = require('./dosing');

const BACKUP_VERSION = 2;

async function buildBackup() {
  const [supp, sess, reg, ph, tmpl, tr, tp, settings] = await Promise.all([
    pool.query('SELECT * FROM supplements'),
    pool.query('SELECT * FROM sessions'),
    pool.query('SELECT * FROM regimens'),
    pool.query('SELECT * FROM phases'),
    pool.query('SELECT * FROM templates'),
    pool.query('SELECT * FROM template_regimens'),
    pool.query('SELECT * FROM template_phases'),
    pool.query('SELECT prefs FROM user_settings WHERE singleton = TRUE'),
  ]);
  return {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    supplements: supp.rows,
    sessions: sess.rows,
    regimens: reg.rows,
    phases: ph.rows,
    templates: tmpl.rows,
    template_regimens: tr.rows,
    template_phases: tp.rows,
    prefs: settings.rows[0]?.prefs ?? {},
  };
}

// A restore TRUNCATEs everything first, so reject anything that isn't a real backup export
// (otherwise `{}` would wipe the database).
function isValidBackup(b) {
  return !!b && typeof b === 'object'
    && (b.version === undefined || b.version === 1 || b.version === 2)
    && ['supplements', 'sessions', 'regimens', 'phases'].every(k => Array.isArray(b[k]))
    && ['templates', 'template_regimens', 'template_phases'].every(k => b[k] === undefined || Array.isArray(b[k]));
}

// Replaces all data in one transaction; returns the restored prefs (or null).
async function restoreBackup(backup) {
  const {
    supplements = [], sessions = [], regimens = [], phases = [],
    templates = [], template_regimens = [], template_phases = [], prefs = null,
  } = backup;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE supplements, sessions, templates CASCADE');
    for (const s of supplements) {
      await client.query(
        `INSERT INTO supplements (id,name,brand,pills_per_bottle,price,type,current_inventory,unit,drops_per_ml,reorder_threshold,reorder_threshold_mode,take_with_food)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [s.id, s.name, s.brand, s.pills_per_bottle, s.price, s.type, s.current_inventory, s.unit || 'capsules',
          s.drops_per_ml ?? 20, s.reorder_threshold ?? null, s.reorder_threshold_mode || 'units', !!s.take_with_food]
      );
    }
    for (const s of sessions) {
      await client.query(
        'INSERT INTO sessions (id,start_date,target_date,notes) VALUES ($1,$2,$3,$4)',
        [s.id, s.start_date, s.target_date, s.notes ?? null]
      );
    }
    for (const r of regimens) {
      // reminder_time is legacy (reminders now derive from the phase slots) and is not restored.
      await client.query(
        'INSERT INTO regimens (id,session_id,supplement_id,notes,as_needed) VALUES ($1,$2,$3,$4,$5)',
        [r.id, r.session_id, r.supplement_id, r.notes ?? null, !!r.as_needed]
      );
    }
    for (const p of phases) {
      const d = normalizePhaseRow(p);
      await client.query(
        `INSERT INTO phases (id,regimen_id,dose_morning,dose_lunch,dose_dinner,custom_slots,duration_days,days_of_week,indefinite,sequence_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [p.id, p.regimen_id, d.dose_morning, d.dose_lunch, d.dose_dinner, JSON.stringify(d.custom_slots),
          p.duration_days, p.days_of_week ?? null, !!p.indefinite, p.sequence_order]
      );
    }
    for (const t of templates) {
      await client.query(
        'INSERT INTO templates (id,name,notes,created_at) VALUES ($1,$2,$3,$4)',
        [t.id, t.name, t.notes ?? null, t.created_at]
      );
    }
    for (const tr of template_regimens) {
      await client.query(
        'INSERT INTO template_regimens (id,template_id,supplement_id,as_needed,created_at) VALUES ($1,$2,$3,$4,$5)',
        [tr.id, tr.template_id, tr.supplement_id, !!tr.as_needed, tr.created_at]
      );
    }
    for (const tp of template_phases) {
      const d = normalizePhaseRow(tp);
      await client.query(
        `INSERT INTO template_phases (id,template_regimen_id,dose_morning,dose_lunch,dose_dinner,custom_slots,duration_days,days_of_week,indefinite,sequence_order,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [tp.id, tp.template_regimen_id, d.dose_morning, d.dose_lunch, d.dose_dinner, JSON.stringify(d.custom_slots),
          tp.duration_days, tp.days_of_week ?? null, !!tp.indefinite, tp.sequence_order, tp.created_at]
      );
    }
    if (prefs) {
      await client.query(
        `INSERT INTO user_settings (singleton, prefs, updated_at)
         VALUES (TRUE, $1, NOW())
         ON CONFLICT (singleton) DO UPDATE SET prefs = $1, updated_at = NOW()`,
        [prefs]
      );
    }
    await client.query('COMMIT');
    return prefs;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { BACKUP_VERSION, buildBackup, isValidBackup, restoreBackup };
