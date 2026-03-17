/**
 * Shared preferences — synchronous, backed by localStorage (works on both web
 * and React Native via Expo's global localStorage polyfill).
 */

export type AccentColor = 'violet' | 'red' | 'orange' | 'amber' | 'green' | 'blue';

export interface AppPrefs {
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  accentColor: AccentColor;
}

const KEY = 'pillpipe_prefs';

const DEFAULT: AppPrefs = { dateFormat: 'MM/DD/YYYY', accentColor: 'violet' };

export const ACCENT_HEX: Record<AccentColor, string> = {
  violet: '#7c3aed',
  red:    '#dc2626',
  orange: '#ea580c',
  amber:  '#d97706',
  green:  '#16a34a',
  blue:   '#2563eb',
};

function ls() { return (globalThis as any).localStorage as Storage | undefined; }

export function loadPrefs(): AppPrefs {
  try {
    const raw = ls()?.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch { /* no-op */ }
  return { ...DEFAULT };
}

export function savePrefs(patch: Partial<AppPrefs>) {
  const current = loadPrefs();
  const next = { ...current, ...patch };
  try { ls()?.setItem(KEY, JSON.stringify(next)); } catch { /* no-op */ }
}

/** Returns a React Native style object for the current accent color background. */
export function accentBg(): { backgroundColor: string } {
  return { backgroundColor: ACCENT_HEX[loadPrefs().accentColor] };
}
