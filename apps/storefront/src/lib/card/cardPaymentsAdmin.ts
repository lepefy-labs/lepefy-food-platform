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

// ─── Notification delivery state (notification_deliveries ledger) ──────────

/** Ledger keys of the automatic emails sent when a /card payment succeeds (notifyCardQuickPayment). */
export function cardPaymentDeliveryKeys(paymentIntentId: string) {
  return { customer: `card-quick-payment-customer:${paymentIntentId}`, team: `card-quick-payment:${paymentIntentId}` };
}

export type CardNotificationState = 'sent' | 'sending' | 'retrying' | 'dead' | 'untracked' | 'no_email' | 'not_applicable';

export const CARD_NOTIFICATION_LABELS: Record<CardNotificationState, string> = {
  sent: 'Envoyée',
  sending: 'En cours d’envoi',
  retrying: 'Échec, nouvel essai prévu',
  dead: 'Échec définitif',
  untracked: 'Aucune trace d’envoi',
  no_email: 'Pas d’e-mail client',
  not_applicable: '—',
};

/** Only real failures are worth a warning in the list; the rest stays in the detail. */
export function isNotificationProblem(state: CardNotificationState) {
  return state === 'retrying' || state === 'dead';
}

/**
 * Display state of one automatic email. A paid payment without a ledger row is
 * "untracked" (e.g. paid before the ledger existed), never reported as a failure.
 */
export function cardNotificationState(
  delivery: { status: string } | null | undefined,
  context: { paid: boolean; hasRecipient: boolean },
): CardNotificationState {
  if (!context.paid) return 'not_applicable';
  if (!context.hasRecipient) return 'no_email';
  if (!delivery) return 'untracked';
  if (delivery.status === 'accepted') return 'sent';
  if (delivery.status === 'failed') return 'retrying';
  if (delivery.status === 'dead') return 'dead';
  return 'sending';
}

// ─── List state in the query string ───────────────────────────────────────

export interface CardPaymentsListState {
  period: CardPaymentPeriod;
  from: string;
  to: string;
  status: CardPaymentStatusFilter;
  q: string;
  page: number;
}

export function parseCardPaymentsState(params: { get(name: string): string | null }): CardPaymentsListState {
  const period = parsePeriod(params.get('period'));
  return {
    period,
    from: period === 'custom' ? parseDay(params.get('from')) ?? '' : '',
    to: period === 'custom' ? parseDay(params.get('to')) ?? '' : '',
    status: parseStatusFilter(params.get('status')),
    q: (params.get('q') ?? '').slice(0, 60),
    page: parsePage(params.get('page')),
  };
}

/** Defaults (7d, all statuses, page 1, no search) are omitted to keep URLs short. */
export function cardPaymentsQueryString(state: CardPaymentsListState): string {
  const params = new URLSearchParams();
  if (state.period !== '7d') params.set('period', state.period);
  if (state.period === 'custom' && state.from) params.set('from', state.from);
  if (state.period === 'custom' && state.to) params.set('to', state.to);
  if (state.status !== 'all') params.set('status', state.status);
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.page > 1) params.set('page', String(state.page));
  return params.toString();
}
