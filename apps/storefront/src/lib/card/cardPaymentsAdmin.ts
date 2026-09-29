/**
 * Admin list of /card payments (tenant_card_payments). Pure helpers shared by
 * the API route, the page and the global search.
 */

/** tenant_card_payments only knows pending | paid; "abandoned" is a display rule. */
export type CardPaymentDisplayStatus = 'paid' | 'in_progress' | 'abandoned';
export type CardPaymentPeriod = 'today' | '7d' | '30d' | 'all' | 'custom';
export type CardPaymentStatusFilter = 'all' | 'paid' | 'unfinished';

/** A pending payment older than this is shown as "Non finalisé". */
export const ABANDONED_AFTER_MS = 60 * 60 * 1000;
export const CARD_PAYMENTS_PAGE_SIZE = 50;

export function displayStatus(row: { status: string; created_at: string }, now = new Date()): CardPaymentDisplayStatus {
  if (row.status === 'paid') return 'paid';
  const created = new Date(row.created_at).getTime();
  return Number.isFinite(created) && now.getTime() - created < ABANDONED_AFTER_MS ? 'in_progress' : 'abandoned';
}

export function parsePeriod(value: string | null | undefined): CardPaymentPeriod {
  return value === 'today' || value === '30d' || value === 'all' || value === 'custom' ? value : '7d';
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar day `YYYY-MM-DD` (from <input type="date">), or null if malformed or impossible. */
export function parseDay(value: string | null | undefined): string | null {
  const match = DAY.exec(value ?? '');
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value! : null;
}

/** Today's calendar day in the shop time zone. */
export function shopDay(now = new Date(), timeZone = 'Europe/Rome') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function zoneOffsetMs(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(at)).reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - at;
}

/** Midnight of a calendar day in the shop time zone (DST-safe), `addDays` later. */
function shopMidnight(day: string, timeZone: string, addDays = 0) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(y, m - 1, d + addDays);
  const guess = utcMidnight - zoneOffsetMs(utcMidnight, timeZone);
  return new Date(utcMidnight - zoneOffsetMs(guess, timeZone));
}

/**
 * created_at bounds of a period: `since` inclusive, `until` exclusive. A custom
 * range covers whole shop-time days, the end day included; reversed days are
 * swapped and a missing day leaves that side open.
 */
export function periodBounds(
  period: CardPaymentPeriod,
  range: { from?: string | null; to?: string | null } = {},
  now = new Date(),
  timeZone = 'Europe/Rome',
): { since: Date | null; until: Date | null } {
  if (period !== 'custom') return { since: periodStart(period, now, timeZone), until: null };
  let from = parseDay(range.from);
  let to = parseDay(range.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    since: from ? shopMidnight(from, timeZone) : null,
    until: to ? shopMidnight(to, timeZone, 1) : null,
  };
}

export function parseStatusFilter(value: string | null | undefined): CardPaymentStatusFilter {
  return value === 'paid' || value === 'unfinished' ? value : 'all';
}

/** Start of the period, "today" in the shop time zone (same zone as the emails). */
export function periodStart(period: CardPaymentPeriod, now = new Date(), timeZone = 'Europe/Rome'): Date | null {
  if (period === 'all' || period === 'custom') return null;
  if (period === '7d') return new Date(now.getTime() - 7 * 86_400_000);
  if (period === '30d') return new Date(now.getTime() - 30 * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const elapsed = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsed);
}

const REFERENCE = /^CP-?([0-9A-F]{6})$/i;

/**
 * CP-A82F31 is the first 6 hex digits of the payment uuid (cardPaymentReference),
 * so a reference maps to a uuid range usable with gte/lte.
 */
export function referenceRange(query: string): { from: string; to: string } | null {
  const match = REFERENCE.exec(query.trim());
  if (!match) return null;
  const prefix = match[1]!.toLowerCase();
  return { from: `${prefix}00-0000-0000-0000-000000000000`, to: `${prefix}ff-ffff-ffff-ffff-ffffffffffff` };
}

/** Free-text search on name / email: safe characters only, for ilike. */
export function sanitizeSearch(raw: string | null | undefined) {
  return (raw ?? '').trim().replace(/[^a-zA-Z0-9À-ÿ@._\- ]/g, '').slice(0, 60);
}

export function stripeDashboardUrl(paymentIntentId: string | null | undefined) {
  return paymentIntentId && /^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ? `https://dashboard.stripe.com/payments/${paymentIntentId}` : null;
}

export function parsePage(value: string | null | undefined) {
  const page = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1;
}
