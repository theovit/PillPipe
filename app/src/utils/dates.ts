export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr + 'T00:00:00' : dateStr;
  const d = new Date(normalized);
  return d.toLocaleDateString();
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
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
