/**
 * Shortfall Engine
 *
 * @param {Object} params
 * @param {Array}  params.phases          - [{dosage, duration_days, days_of_week, sequence_order}]
 * @param {number} params.inventory       - current pill count
 * @param {string} params.startDate       - ISO date string (session start)
 * @param {string} params.targetDate      - ISO date string (next appointment)
 * @param {number} params.pillsPerBottle  - pills per purchasable unit
 * @param {number} params.pricePerBottle  - cost per bottle
 */
function calculate({ phases, inventory, startDate, targetDate, pillsPerBottle, pricePerBottle }) {
  const start = new Date(startDate);
  const target = new Date(targetDate);
  const totalDays = Math.ceil((target - start) / (1000 * 60 * 60 * 24));

  const sorted = [...phases].sort((a, b) => a.sequence_order - b.sequence_order);

  // How many calendar days have elapsed since session start (capped to session window)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysElapsed = Math.min(
    Math.max(0, Math.floor((today - start) / (1000 * 60 * 60 * 24))),
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
    const phaseDays = phase.indefinite ? (totalDays - currentDay) : phase.duration_days;

    for (let d = 0; d < phaseDays; d++) {
      if (currentDay >= totalDays) break;

      // Check if this calendar day is a dosing day
      const calDate = new Date(start);
      calDate.setDate(calDate.getDate() + currentDay);
      const dayOfWeek = calDate.getDay(); // 0=Sun ... 6=Sat

      const isDosing = dow ? dow.includes(dayOfWeek) : true;

      if (isDosing) {
        pillsNeeded += phase.dosage;
        if (currentDay < daysElapsed) pillsConsumedToDate += phase.dosage;
        if (remaining >= phase.dosage) {
          remaining -= phase.dosage;
          daysCovered = currentDay + 1;
        } else if (runOutDay === null) {
          runOutDay = currentDay;
        }
      }

      currentDay++;
    }
    if (currentDay >= totalDays) break;
  }

  const shortfall = Math.max(0, pillsNeeded - inventory);
  const covered = shortfall === 0;
  const daysShort = covered ? 0 : totalDays - daysCovered;

  let bottlesNeeded = 0;
  let waste = 0;
  let estimatedCost = 0;

  if (!covered && pillsPerBottle) {
    bottlesNeeded = Math.ceil(shortfall / pillsPerBottle);
    const pillsBought = bottlesNeeded * pillsPerBottle;
    waste = pillsBought - shortfall;
    estimatedCost = bottlesNeeded * (pricePerBottle || 0);
  }

  const currentOnHand = Math.max(0, inventory - pillsConsumedToDate);

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
