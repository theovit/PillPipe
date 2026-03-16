const STORAGE_KEY = 'pillpipe_prefs';

const DEFAULTS = {
  accentColor: 'violet',
  customColor: null,   // hex string, only used when accentColor === 'custom'
  fontSize: 'medium',
  dateFormat: 'locale',
  defaultDuration: 0,
};

// Preset palette — hardcoded hex so swatch buttons always show their true color
// regardless of which theme is active (swatches use inline style, not Tailwind classes).
export const PRESET_COLORS = [
  { key: 'violet', hex: '#7c3aed', shades: { 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9' } },
  { key: 'blue',   hex: '#2563eb', shades: { 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' } },
  { key: 'cyan',   hex: '#0891b2', shades: { 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2', 700: '#0e7490' } },
  { key: 'green',  hex: '#16a34a', shades: { 300: '#86efac', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d' } },
  { key: 'orange', hex: '#ea580c', shades: { 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c' } },
  { key: 'rose',   hex: '#e11d48', shades: { 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c' } },
];

// ── Custom color shade generation ─────────────────────────────────────────────

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Derive five shades from any hex color using fixed lightness targets.
export function generateShades(hex) {
  const [h, s] = hexToHsl(hex);
  // Clamp saturation so very gray picks look reasonable
  const sat = Math.max(s, 40);
  return {
    300: hslToHex(h, sat, 72),
    400: hslToHex(h, sat, 62),
    500: hslToHex(h, sat, 52),
    600: hslToHex(h, sat, 43),
    700: hslToHex(h, sat, 35),
  };
}

// ── Apply functions ───────────────────────────────────────────────────────────

// Override violet-* CSS variables with direct hex values.
// Swatches in the UI use inline style={{ backgroundColor }} so they are immune.
function applyShades(shades) {
  const root = document.documentElement;
  Object.entries(shades).forEach(([shade, hex]) =>
    root.style.setProperty(`--color-violet-${shade}`, hex)
  );
}

function clearShades() {
  const root = document.documentElement;
  ['300', '400', '500', '600', '700'].forEach(s =>
    root.style.removeProperty(`--color-violet-${s}`)
  );
}

export function applyAccentColor(colorName, customHex) {
  if (!colorName || colorName === 'violet') {
    clearShades();
    return;
  }
  if (colorName === 'custom') {
    if (!customHex) { clearShades(); return; }
    applyShades(generateShades(customHex));
    return;
  }
  const preset = PRESET_COLORS.find(c => c.key === colorName);
  if (preset) applyShades(preset.shades);
  else clearShades();
}

export function applyFontSize(size) {
  const map = { small: '14px', medium: '16px', large: '18px' };
  document.documentElement.style.fontSize = map[size] ?? '16px';
}

export function applyPrefs(prefs) {
  applyAccentColor(prefs.accentColor, prefs.customColor);
  applyFontSize(prefs.fontSize);
}

// ── Storage ───────────────────────────────────────────────────────────────────

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

// ── Date helpers ──────────────────────────────────────────────────────────────

export function formatDate(dateStr, format = 'locale') {
  if (!dateStr) return '';
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

export function defaultTargetDate(durationDays) {
  if (!durationDays || durationDays <= 0) return '';
  const d = new Date();
  d.setDate(d.getDate() + Number(durationDays));
  return d.toISOString().slice(0, 10);
}
