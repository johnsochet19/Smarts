// Date helpers for the Gantt — day-granularity, timezone-safe (parse date-only
// strings as local midnight; never rely on Date string TZ parsing).

export const DAY_MS = 86400000;

export function parseDay(value?: string | null): Date | null {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Whole days from a→b (b - a), ignoring DST via rounding. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

export function maxDate(a: Date, b: Date): Date { return a.getTime() >= b.getTime() ? a : b; }
export function minDate(a: Date, b: Date): Date { return a.getTime() <= b.getTime() ? a : b; }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthLabel(d: Date): string { return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
export function shortDay(d: Date): string { return String(d.getDate()); }
