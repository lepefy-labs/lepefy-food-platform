/**
 * Pure rules behind /admin/nala-analytics (no I/O): message redaction,
 * which attributed orders count as revenue, activity buckets in the shop's
 * time zone and the conversation → order funnel.
 */

export const ANALYTICS_TIME_ZONE = 'Europe/Rome';
/** Below this share of analysed messages the quality signals are flagged as partial. */
export const ENRICHMENT_WARNING_PERCENT = 90;
export const EXAMPLE_MAX_LENGTH = 120;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// 7+ digits, optionally separated by spaces, dots, dashes or parentheses, with an optional +.
const PHONE_PATTERN = /\+?\d(?:[\s.\-()]*\d){6,}/g;

/**
 * Customer message as shown to the tenant admin: contact details masked,
 * whitespace collapsed, truncated. The customer's identity is never shown.
 */
export function redactMessage(text: string | null | undefined, max = EXAMPLE_MAX_LENGTH): string {
  const clean = (text ?? '')
    .replace(EMAIL_PATTERN, '[e-mail]')
    .replace(PHONE_PATTERN, '[téléphone]')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export interface AttributedOrder {
  is_test: boolean | null;
  status: string | null;
  payment_status: string | null;
}

/** Revenue counts only real, paid, non-cancelled orders (refunds and test orders excluded). */
export function isCountableOrder(order: AttributedOrder | undefined): boolean {
  if (!order) return false;
  return order.is_test !== true && order.status !== 'cancelled' && order.payment_status === 'paid';
}

const keyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: ANALYTICS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD of an instant in the shop's time zone. */
export function localDateKey(value: string | Date): string {
  return keyFormatter.format(typeof value === 'string' ? new Date(value) : value);
}

function keyToUtcMs(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function shiftKey(key: string, days: number): string {
  return new Date(keyToUtcMs(key) + days * 86_400_000).toISOString().slice(0, 10);
}

const labelFormatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const dayLabel = (key: string) => labelFormatter.format(new Date(keyToUtcMs(key))).replace('.', '');

export interface ActivityBucket {
  key: string;
  label: string;
  /** Inclusive first and last local day of the bucket. */
  from: string;
  to: string;
  interactions: number;
  assistedRevenue: number;
}

export type BucketSize = 'day' | 'week';

export function bucketSizeFor(rangeDays: number): BucketSize {
  return rangeDays > 30 ? 'week' : 'day';
}

/** Buckets covering the whole range, oldest first, ending today (local). */
export function activityBuckets(rangeDays: number, now: Date = new Date()): ActivityBucket[] {
  const today = localDateKey(now);
  const size = bucketSizeFor(rangeDays) === 'week' ? 7 : 1;
  const count = Math.ceil(rangeDays / size);
  const buckets: ActivityBucket[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const to = shiftKey(today, -index * size);
    const from = shiftKey(to, -(size - 1));
    buckets.push({ key: from, label: dayLabel(from), from, to, interactions: 0, assistedRevenue: 0 });
  }
  return buckets;
}

/** Index of the bucket holding this instant, or -1 when outside the range. */
export function bucketIndexFor(buckets: ActivityBucket[], value: string): number {
  const key = localDateKey(value);
  return buckets.findIndex((bucket) => key >= bucket.from && key <= bucket.to);
}

export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export interface FunnelStep {
  key: 'conversations' | 'cart' | 'checkout' | 'order';
  label: string;
  count: number;
  /** Share of conversations. */
  rate: number;
}

export function conversionFunnel(counts: { conversations: number; cart: number; checkout: number; order: number }): FunnelStep[] {
  const base = counts.conversations;
  return [
    { key: 'conversations', label: 'Conversations', count: base, rate: base > 0 ? 100 : 0 },
    { key: 'cart', label: 'Ajout au panier', count: counts.cart, rate: percent(counts.cart, base) },
    { key: 'checkout', label: 'Paiement commencé', count: counts.checkout, rate: percent(counts.checkout, base) },
    { key: 'order', label: 'Commande payée', count: counts.order, rate: percent(counts.order, base) },
  ];
}

/** Distinct conversations behind conversion events (falls back to the interaction, then the event itself). */
export function distinctConversationKeys(rows: Array<{ nala_session_id: string | null; nala_interaction_id: string | null }>): number {
  const keys = new Set<string>();
  rows.forEach((row, index) => keys.add(row.nala_session_id ?? row.nala_interaction_id ?? `event:${index}`));
  return keys.size;
}
