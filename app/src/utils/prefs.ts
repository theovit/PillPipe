/**
 * Shared preferences — synchronous reads via module-level cache,
 * async persistence via AsyncStorage.
 * Call initPrefs() once at app startup before rendering screens.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Module-level cache — populated by initPrefs() at app startup.
let _cache: AppPrefs = { ...DEFAULT };

/** Load persisted prefs from AsyncStorage into the module cache. Call once at app startup. */
export async function initPrefs(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) _cache = { ...DEFAULT, ...JSON.parse(raw) };
  } catch { /* use defaults */ }
}

/** Synchronous read from the module cache. Always up-to-date after initPrefs() resolves. */
export function loadPrefs(): AppPrefs {
  return { ..._cache };
}

/** Update the cache and persist asynchronously (fire-and-forget). */
export function savePrefs(patch: Partial<AppPrefs>): void {
  _cache = { ..._cache, ...patch };
  AsyncStorage.setItem(KEY, JSON.stringify(_cache)).catch(() => { /* no-op */ });
}

/** Returns a React Native style object for the current accent color background. */
export function accentBg(): { backgroundColor: string } {
  return { backgroundColor: ACCENT_HEX[_cache.accentColor] };
}
