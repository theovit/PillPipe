const { dailyDose, round6 } = require('./dosing');

const DAY_MS = 86400000;

// Date math on 'YYYY-MM-DD' strings only, in UTC — never local Date getters/setters. A local-time
// approach drifts by a day across a DST transition (a local calendar day can be 23 or 25 hours);
// mirrors server/dosing.js's own ymdToUtc, which was written for exactly this reason.
function ymdToUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}

/**
 * Shortfall Engine
 *
 * @param {Object} params
 * @param {Array}  params.phases          - [{dose_morning, dose_lunch, dose_dinner, custom_slots, duration_days, days_of_week, sequence_order}]
 * @param {number} params.inventory       - current pill count
 * @param {string} params.startDate       - 'YYYY-MM-DD' (session start)
 * @param {string} params.targetDate      - 'YYYY-MM-DD' (next appointment)
 * @param {number} params.pillsPerBottle  - pills per purchasable unit
 * @param {number} params.pricePerBottle  - cost per bottle
 * @param {string} [params.today]         - the owner's wall-clock date ('YYYY-MM-DD', from nowInTz);
 *                                          defaults to the server's own clock (UTC) if omitted
 */
function calculate({ phases, inventory, startDate, targetDate, pillsPerBottle, pricePerBottle, today }) {
  const startUtc = ymdToUtc(startDate);
  const totalDays = Math.round((ymdToUtc(targetDate) - startUtc) / DAY_MS);

  const sorted = [...phases].sort((a, b) => a.sequence_order - b.sequence_order);

  // How many calendar days have elapsed since session start (capped to session window).
  const todayUtc = today ? ymdToUtc(today) : Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const daysElapsed = Math.min(
    Math.max(0, Math.floor((todayUtc - startUtc) / DAY_MS)),
    totalDays
  );

  let pillsNeeded = 0;
  let pillsConsumedToDate = 0;
  let daysCovered = 0;
  let runOutDay = null;
  let remaining = inventory;
  let currentDay = 0;

  for (const phase of sorted) {
    const dow = phase.days_of_week && phase.days_of_week.length > 0 ? phase.days_of_week : null;
    const phaseDays = phase.indefinite ? (totalDays - currentDay) : Number(phase.duration_days);
    // Sum of the meal + custom slot amounts (pg NUMERIC strings coerced, float noise rounded away)
    const dosage = dailyDose(phase);

    for (let d = 0; d < phaseDays; d++) {
      if (currentDay >= totalDays) break;

      // Check if this calendar day is a dosing day
      const dayOfWeek = new Date(startUtc + currentDay * DAY_MS).getUTCDay(); // 0=Sun ... 6=Sat
      const isDosing = dow ? dow.includes(dayOfWeek) : true;

      if (isDosing) {
        pillsNeeded = round6(pillsNeeded + dosage);
        if (currentDay < daysElapsed) pillsConsumedToDate = round6(pillsConsumedToDate + dosage);
        if (remaining >= dosage) {
          remaining = round6(remaining - dosage);
          daysCovered = currentDay + 1;
        } else if (runOutDay === null) {
          runOutDay = currentDay;
        }
      }

      currentDay++;
    }
    if (currentDay >= totalDays) break;
  }

  const shortfall = Math.max(0, round6(pillsNeeded - inventory));
  const covered = shortfall === 0;
  const daysShort = covered ? 0 : totalDays - daysCovered;

  let bottlesNeeded = 0;
  let waste = 0;
  let estimatedCost = 0;

  if (!covered && pillsPerBottle) {
    bottlesNeeded = Math.ceil(shortfall / pillsPerBottle);
    const pillsBought = bottlesNeeded * pillsPerBottle;
    waste = round6(pillsBought - shortfall);
    estimatedCost = bottlesNeeded * (pricePerBottle || 0);
  }

  const currentOnHand = Math.max(0, round6(inventory - pillsConsumedToDate));

  return {
    status: covered ? 'covered' : 'shortfall',
    totalDays,
    daysElapsed,
    pillsNeeded,
    pillsConsumedToDate,
    inventory,
    currentOnHand,
    shortfall,
    daysShort,
    runOutDay,
    bottlesNeeded,
    waste,
    estimatedCost,
    wasteWarning: waste > 0,
  };
}

module.exports = { calculate };
