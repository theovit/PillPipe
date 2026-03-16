const STORAGE_KEY = 'pillpipe_prefs';

const DEFAULTS = {
  accentColor: 'violet',
  fontSize: 'medium',
  dateFormat: 'locale',
  defaultDuration: 0,
};

export function loadPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

// Override the violet CSS variables at root level so all bg-violet-* / text-violet-* classes
// pick up the new color automatically — no component changes needed.
export function applyAccentColor(colorName) {
  const shades = ['300', '400', '500', '600', '700'];
  const root = document.documentElement;
  if (!colorName || colorName === 'violet') {
    shades.forEach(s => root.style.removeProperty(`--color-violet-${s}`));
  } else {
    shades.forEach(s =>
      root.style.setProperty(`--color-violet-${s}`, `var(--color-${colorName}-${s})`)
    );
  }
}

// Tailwind v4 text utilities use rem, so changing the root font-size scales the whole UI.
export function applyFontSize(size) {
  const map = { small: '14px', medium: '16px', large: '18px' };
  document.documentElement.style.fontSize = map[size] ?? '16px';
}

export function applyPrefs(prefs) {
  applyAccentColor(prefs.accentColor);
  applyFontSize(prefs.fontSize);
}

// Format a date string (YYYY-MM-DD or full ISO) for display according to the user's preference.
export function formatDate(dateStr, format = 'locale') {
  if (!dateStr) return '';
  // If it's a bare date (YYYY-MM-DD), append time to force local timezone interpretation.
  // If it already has a time component, parse as-is.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr + 'T00:00:00' : dateStr;
  const d = new Date(normalized);
  if (format === 'locale') return d.toLocaleDateString();
  const pad = n => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  if (format === 'mdy') return `${m}/${day}/${y}`;
  if (format === 'dmy') return `${day}/${m}/${y}`;
  if (format === 'ymd') return `${y}-${m}-${day}`;
  return d.toLocaleDateString();
}

// Return a YYYY-MM-DD string durationDays from today, or '' if duration is 0/falsy.
export function defaultTargetDate(durationDays) {
  if (!durationDays || durationDays <= 0) return '';
  const d = new Date();
  d.setDate(d.getDate() + Number(durationDays));
  return d.toISOString().slice(0, 10);
}
