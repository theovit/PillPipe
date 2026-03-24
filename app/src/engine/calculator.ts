export interface Phase {
  dosage: number;          // legacy — kept for backward compatibility
  dose_morning: number;
  dose_lunch: number;
  dose_dinner: number;
  dose_custom: number;
  duration_days: number;
  /** JSON-encoded int[] stored in SQLite, e.g. "[1,3,5]" or null */
  days_of_week: string | null;
  indefinite: number | boolean; // SQLite stores boolean as 0/1
  sequence_order: number;
}

export interface CalculateParams {
  phases: Phase[];
  inventory: number;
  startDate: string;
  targetDate: string;
  pillsPerBottle: number;
  pricePerBottle: number;
}

export interface CalculateResult {
  status: 'covered' | 'shortfall';
  totalDays: number;
  daysElapsed: number;
  pillsNeeded: number;
  pillsConsumedToDate: number;
  inventory: number;
  currentOnHand: number;
  shortfall: number;
  daysShort: number;
  runOutDay: number | null;
  bottlesNeeded: number;
  waste: number;
  estimatedCost: number;
  wasteWarning: boolean;
}

export function calculate({
  phases,
  inventory,
  startDate,
  targetDate,
  pillsPerBottle,
  pricePerBottle,
}: CalculateParams): CalculateResult {
  const start = new Date(startDate);
  const target = new Date(targetDate);
  const totalDays = Math.ceil((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  const sorted = [...phases].sort((a, b) => a.sequence_order - b.sequence_order);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysElapsed = Math.min(
    Math.max(0, Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))),
    totalDays,
  );

  let pillsNeeded = 0;
  let pillsConsumedToDate = 0;
  let daysCovered = 0;
  let runOutDay: number | null = null;
  let remaining = inventory;
  let currentDay = 0;

  for (const phase of sorted) {
    // days_of_week stored as JSON string in SQLite
    const dowRaw = phase.days_of_week;
    const dow: number[] | null =
      dowRaw && dowRaw.length > 2 ? (JSON.parse(dowRaw) as number[]) : null;

    const isIndef = phase.indefinite === 1 || phase.indefinite === true;
    const phaseDays = isIndef ? totalDays - currentDay : Number(phase.duration_days);
    const dosage = Number(phase.dosage);

    for (let d = 0; d < phaseDays; d++) {
      if (currentDay >= totalDays) break;

      const calDate = new Date(start);
      calDate.setDate(calDate.getDate() + currentDay);
      const dayOfWeek = calDate.getDay();

      const isDosing = dow ? dow.includes(dayOfWeek) : true;

      if (isDosing) {
        pillsNeeded += dosage;
        if (currentDay < daysElapsed) pillsConsumedToDate += dosage;
        if (remaining >= dosage) {
          remaining -= dosage;
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
