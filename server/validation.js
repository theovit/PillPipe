// Request-body validation (zod) for the routes that didn't already have it — phases
// (dosing.js's validatePhaseBody), backup/restore (isValidBackup) and push/subscribe were already
// covered. `validate(schema)` only rejects bad input; it never replaces req.body, so every route
// keeps reading req.body exactly as before (some rely on hasOwnProperty for partial-update
// semantics — see the PATCH /regimens/:id comment — which a body swap would silently break).
const { z } = require('zod');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: result.error.issues.map(i => `${i.path.join('.') || '(body)'}: ${i.message}`),
      });
    }
    next();
  };
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const notes = z.string().max(2000).nullable().optional();
const id = z.string().min(1).max(200);

const supplementBody = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullable().optional(),
  pills_per_bottle: z.number().finite().nonnegative(),
  price: z.number().finite().nonnegative(),
  type: z.enum(['maintenance', 'protocol']),
  current_inventory: z.number().finite().nonnegative().optional(),
  unit: z.enum(['capsules', 'tablets', 'ml', 'drops']).optional(),
  drops_per_ml: z.number().finite().positive().optional(),
  reorder_threshold: z.number().finite().nonnegative().nullable().optional(),
  reorder_threshold_mode: z.enum(['units', 'days']).optional(),
  take_with_food: z.boolean().optional(),
});

const supplementInventoryPatchBody = z.object({
  current_inventory: z.number().finite(), // the route itself clamps negatives to 0
});

const sessionCreateBody = z.object({
  start_date: dateStr,
  target_date: dateStr,
  notes,
  // The client form sends '' when no template is picked; the route treats falsy as "none".
  template_id: z.union([id, z.literal('')]).nullable().optional(),
});

const sessionUpdateBody = z.object({
  start_date: dateStr,
  target_date: dateStr,
  notes,
});

const templateNameBody = z.object({
  name: z.string().trim().min(1).max(200),
});

const addRegimenBody = z.object({
  supplement_id: id,
});

const regimenPatchBody = z.object({
  notes,
  as_needed: z.boolean().optional(),
});

const doseLogBody = z.object({
  regimen_id: id,
  date: dateStr,
  status: z.enum(['taken', 'skipped']),
});

// prefs is a free-form, evolving settings bag (timezone, colorScheme, mealTimes, ...) — checked
// for shape and a sane size cap rather than an exhaustive per-key schema that would need updating
// every time a new preference ships.
const prefsBody = z.record(z.string(), z.unknown())
  .refine(v => JSON.stringify(v).length <= 20000, { message: 'prefs payload too large' });

module.exports = {
  validate,
  supplementBody,
  supplementInventoryPatchBody,
  sessionCreateBody,
  sessionUpdateBody,
  templateNameBody,
  addRegimenBody,
  regimenPatchBody,
  doseLogBody,
  prefsBody,
};
