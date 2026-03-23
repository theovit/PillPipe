export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const [y, m, day] = dateStr.split('-');
  try {
    const { loadPrefs } = require('./prefs');
    const { dateFormat } = loadPrefs();
    if (dateFormat === 'DD/MM/YYYY') return `${day}/${m}/${y}`;
    if (dateFormat === 'YYYY-MM-DD') return dateStr;
  } catch { /* no-op */ }
  return `${m}/${day}/${y}`; // default MM/DD/YYYY
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function fmtAmount(value: number, unit: string): string {
  if (unit === 'drops') return `${value} drops`;
  if (unit === 'ml') return `${value} ml`;
  if (unit === 'tablets') return `${value} tabs`;
  return `${value} caps`;
}
