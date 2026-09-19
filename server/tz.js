// Timezone helpers. The containers run in UTC, so "today" and "8:00 AM" must come from the owner's
// timezone (prefs.timezone, an IANA name auto-filled by the client) rather than the server clock.
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// First valid of: the requested zone, the process TZ, UTC.
function resolveTimezone(tz) {
  if (isValidTimezone(tz)) return tz;
  if (isValidTimezone(process.env.TZ)) return process.env.TZ;
  return 'UTC';
}

// Wall-clock view of `now` in a zone: { date: 'YYYY-MM-DD', hhmm: 'HH:MM', dow: 0-6 (0 = Sunday), timezone }.
// hourCycle 'h23' avoids the "24:05" midnight quirk that hour12:false produces on some Node builds.
function nowInTz(tz, now = new Date()) {
  const timezone = resolveTimezone(tz);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${get('hour')}:${get('minute')}`,
    dow: WEEKDAYS[get('weekday')],
    timezone,
  };
}

module.exports = { isValidTimezone, resolveTimezone, nowInTz };
