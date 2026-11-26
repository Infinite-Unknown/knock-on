// Business-day arithmetic on plain ISO dates ("YYYY-MM-DD"), always in UTC
// so the result never depends on the server's time zone.

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function toUtc(date) {
  if (!isIsoDate(date)) throw new TypeError(`Not an ISO date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`);
}

function fromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isWeekend(date) {
  const day = new Date(toUtc(date)).getUTCDay();
  return day === 0 || day === 6;
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Add n business days (Mon–Fri). n = 0 returns the date unchanged. */
export function addBusinessDays(date, n) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`n must be a non-negative integer, got ${n}`);
  let ms = toUtc(date);
  let left = n;
  while (left > 0) {
    ms += DAY_MS;
    const day = new Date(ms).getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return fromUtc(ms);
}

/**
 * Business days from a to b: positive when b is later. Counts the weekdays in
 * (a, b], so Fri -> Mon is 1 and a date to itself is 0.
 */
export function businessDaysBetween(a, b) {
  const start = toUtc(a);
  const end = toUtc(b);
  if (start === end) return 0;
  const sign = end > start ? 1 : -1;
  const [lo, hi] = sign > 0 ? [start, end] : [end, start];
  let count = 0;
  for (let ms = lo + DAY_MS; ms <= hi; ms += DAY_MS) {
    const day = new Date(ms).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return sign * count;
}

export function maxDate(...dates) {
  const real = dates.filter(Boolean);
  if (real.length === 0) return null;
  return real.reduce((a, b) => (a >= b ? a : b));
}

export function formatShort(date) {
  if (!isIsoDate(date)) return '-';
  return new Date(toUtc(date)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
