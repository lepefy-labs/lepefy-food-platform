import type { SupabaseClient } from '@supabase/supabase-js';
import { defineListParams, pageWindow, type ListParamValues, type PageWindow } from '@/lib/admin/listParams';
import {
  classifyEmail, EMAIL_CATEGORIES, FOOD_EMAIL_TAGS, typesForCategory,
  type EmailCategory,
} from '@/lib/notifications/brevoEvents';

/**
 * Email Analytics (platform owner) — pure aggregation over
 * `brevo_email_message_summary` rows (migration 170) plus the server-side loader.
 * A row is ONE message to ONE recipient; every KPI is given per message and per
 * distinct recipient, and a rate always comes with its denominator.
 */

export const ANALYTICS_LIST = defineListParams({
  range: { type: 'enum', values: ['7', '30', '90', 'custom'], default: '30' },
  from: { type: 'date' },
  to: { type: 'date' },
  tenant: { type: 'uuid' },
  category: { type: 'enum', values: ['all', ...EMAIL_CATEGORIES], default: 'all' },
  event: { type: 'enum', values: ['all', 'delivered', 'opened', 'clicked', 'failed', 'error', 'no_open'], default: 'all' },
}, { pageSizes: [25, 50, 100], defaultPageSize: 25 });

export type AnalyticsValues = ListParamValues<typeof ANALYTICS_LIST.spec>;

/** An "opening" this soon after delivery is a mail-scanner or prefetch, not a person. */
export const SUSPICIOUS_OPEN_SECONDS = 3;
export const ANALYTICS_TIME_ZONE = 'Europe/Paris';
export const MAX_ANALYTICS_ROWS = 30_000;

export interface MessageRow {
  message_id: string;
  recipient_hash: string;
  first_event_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  first_open_at: string | null;
  proxy_open_at: string | null;
  click_at: string | null;
  click_events: number;
  open_events: number;
  failed_at: string | null;
  failure_event: 'hard_bounce' | 'soft_bounce' | 'blocked' | 'invalid' | 'spam' | null;
  has_error: boolean;
  has_deferred: boolean;
  recipient_masked: string | null;
  /** Readable address (rows received after migration 172); older rows only have the masked form. */
  recipient_email: string | null;
  links: string[] | null;
  tags: string[] | null;
  template_id: number | null;
  reason: string | null;
  delivery_id: string | null;
  tenant_id: string | null;
  notification_type: string | null;
  subject: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

export type OpenKind = 'none' | 'human_likely' | 'suspicious' | 'proxy_only';

export interface EnrichedMessage extends MessageRow {
  category: EmailCategory;
  /** delivered, or failed — what the provider finally reported. */
  delivered: boolean;
  undelivered: boolean;
  openKind: OpenKind;
  clicked: boolean;
}

const ms = (value: string | null) => (value ? Date.parse(value) : NaN);

export function openKindOf(row: Pick<MessageRow, 'delivered_at' | 'first_open_at' | 'proxy_open_at'>): OpenKind {
  if (row.first_open_at) {
    const gap = (ms(row.first_open_at) - ms(row.delivered_at)) / 1000;
    return Number.isFinite(gap) && gap >= 0 && gap < SUSPICIOUS_OPEN_SECONDS ? 'suspicious' : 'human_likely';
  }
  return row.proxy_open_at ? 'proxy_only' : 'none';
}

/** Keeps only Food messages and attaches the derived fields. */
export function enrich(rows: readonly MessageRow[]): EnrichedMessage[] {
  const out: EnrichedMessage[] = [];
  for (const row of rows) {
    const category = classifyEmail({ notificationType: row.notification_type, tags: row.tags, hasLedgerMatch: row.delivery_id !== null });
    if (!category) continue;
    const delivered = row.delivered_at !== null;
    out.push({
      ...row,
      category,
      delivered,
      // A soft bounce that was later delivered is a delay, not a failure.
      undelivered: !delivered && row.failure_event !== null,
      openKind: openKindOf(row),
      clicked: row.click_at !== null,
    });
  }
  return out;
}

export interface Counted { messages: number; recipients: number }
export interface Rate { value: number | null; numerator: number; denominator: number }

export interface Kpis {
  tracked: Counted;
  delivered: Counted;
  firstOpen: Counted;
  clicked: Counted;
  undelivered: Counted;
  errors: Counted;
  suspiciousOpens: number;
  proxyOnly: number;
  deliveryRate: Rate;
  firstOpenRate: Rate;
  clickRate: Rate;
  /** null = not available (no message with both a delivery and a human-like open). */
  medianOpenDelaySeconds: number | null;
  medianOpenSample: number;
}

function counted(rows: readonly EnrichedMessage[], predicate: (row: EnrichedMessage) => boolean): Counted {
  const hit = rows.filter(predicate);
  return { messages: hit.length, recipients: new Set(hit.map((row) => row.recipient_hash)).size };
}

function rate(numerator: number, denominator: number): Rate {
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computeKpis(rows: readonly EnrichedMessage[]): Kpis {
  const tracked = counted(rows, () => true);
  const delivered = counted(rows, (row) => row.delivered);
  const firstOpen = counted(rows, (row) => row.openKind === 'human_likely' || row.openKind === 'suspicious');
  const clicked = counted(rows, (row) => row.clicked);
  const undelivered = counted(rows, (row) => row.undelivered);
  const errors = counted(rows, (row) => row.has_error);
  const delays = rows
    .filter((row) => row.openKind === 'human_likely' && row.delivered_at && row.first_open_at)
    .map((row) => (ms(row.first_open_at) - ms(row.delivered_at)) / 1000)
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0);
  return {
    tracked, delivered, firstOpen, clicked, undelivered, errors,
    suspiciousOpens: rows.filter((row) => row.openKind === 'suspicious').length,
    proxyOnly: rows.filter((row) => row.openKind === 'proxy_only').length,
    // Delivery is measured on what Brevo reported; opens and clicks on delivered messages only.
    deliveryRate: rate(delivered.messages, tracked.messages),
    firstOpenRate: rate(rows.filter((row) => row.delivered && (row.openKind === 'human_likely' || row.openKind === 'suspicious')).length, delivered.messages),
    clickRate: rate(rows.filter((row) => row.delivered && row.clicked).length, delivered.messages),
    medianOpenDelaySeconds: median(delays),
    medianOpenSample: delays.length,
  };
}

// ─── Series ─────────────────────────────────────────────────────────────────

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ANALYTICS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** `YYYY-MM-DD` in shop time. */
export const dayKey = (iso: string) => dayFormat.format(new Date(iso));

export interface DayPoint { day: string; sent: number; delivered: number; firstOpen: number; clicked: number }

/**
 * Daily series. Every metric is placed on the day of ITS OWN event (a delivery
 * on the day it happened), which is what a trend reads; days without events
 * are present with 0 because the webhook was listening (the window is
 * clipped to the first tracked day by the caller).
 */
export function dailySeries(rows: readonly EnrichedMessage[], fromDay: string, toDay: string): DayPoint[] {
  const points = new Map<string, DayPoint>();
  for (let t = Date.parse(`${fromDay}T12:00:00Z`); t <= Date.parse(`${toDay}T12:00:00Z`) && points.size < 400; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    points.set(day, { day, sent: 0, delivered: 0, firstOpen: 0, clicked: 0 });
  }
  const bump = (iso: string | null, key: keyof Omit<DayPoint, 'day'>) => {
    if (!iso) return;
    const point = points.get(dayKey(iso));
    if (point) point[key] += 1;
  };
  for (const row of rows) {
    bump(row.sent_at ?? row.first_event_at, 'sent');
    bump(row.delivered_at, 'delivered');
    if (row.openKind === 'human_likely' || row.openKind === 'suspicious') bump(row.first_open_at, 'firstOpen');
    bump(row.click_at, 'clicked');
  }
  return [...points.values()];
}

export function categoryDistribution(rows: readonly EnrichedMessage[]): Array<{ category: EmailCategory; messages: number }> {
  const counts = new Map<EmailCategory, number>();
  for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  return EMAIL_CATEGORIES.map((category) => ({ category, messages: counts.get(category) ?? 0 })).filter((item) => item.messages > 0);
}

export const FAILURE_LABELS: Record<string, string> = {
  hard_bounce: 'Rebond définitif (hard bounce)',
  soft_bounce: 'Rebond temporaire (soft bounce)',
  blocked: 'Bloqué',
  invalid: 'Adresse invalide',
  spam: 'Signalé comme spam',
  error: 'Erreur d’envoi',
};

export function failureDistribution(rows: readonly EnrichedMessage[]): Array<{ kind: string; label: string; messages: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.undelivered && row.failure_event) counts.set(row.failure_event, (counts.get(row.failure_event) ?? 0) + 1);
    if (row.has_error) counts.set('error', (counts.get('error') ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, messages]) => ({ kind, label: FAILURE_LABELS[kind] ?? kind, messages })).sort((a, b) => b.messages - a.messages);
}

// ─── Period ─────────────────────────────────────────────────────────────────

export interface Period { fromDay: string; toDay: string; fromIso: string; toIso: string; label: string }

/** Window in shop days (Europe/Paris); a `from` date makes it custom (`to` defaults to today). Max 400 days. */
export function resolvePeriod(values: Pick<AnalyticsValues, 'range' | 'from' | 'to'>, now: Date = new Date()): Period {
  const today = dayFormat.format(now);
  let toDay = today;
  let fromDay: string;
  if (values.from) {
    fromDay = values.from;
    toDay = values.to && values.to >= values.from ? values.to : today;
    if (toDay > today) toDay = today;
    if (fromDay > toDay) fromDay = toDay;
  } else {
    const days = values.range === '7' ? 7 : values.range === '90' ? 90 : 30;
    fromDay = new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  }
  const floor = new Date(Date.parse(`${toDay}T12:00:00Z`) - 399 * 86_400_000).toISOString().slice(0, 10);
  if (fromDay < floor) fromDay = floor;
  // Day bounds in shop time: noon UTC of the day shifted by the zone offset keeps DST right.
  return { fromDay, toDay, fromIso: shopDayStart(fromDay), toIso: shopDayStart(addDay(toDay)), label: `${fromDay} → ${toDay}` };
}

function addDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** UTC instant of 00:00 shop time on `day`. */
export function shopDayStart(day: string): string {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ANALYTICS_TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asShop = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess - (asShop - guess)).toISOString();
}

// ─── Loader ─────────────────────────────────────────────────────────────────

const COLUMNS = 'message_id, recipient_hash, first_event_at, sent_at, delivered_at, first_open_at, proxy_open_at, click_at, click_events, open_events, failed_at, failure_event, has_error, has_deferred, recipient_masked, recipient_email, links, tags, template_id, reason, delivery_id, tenant_id, notification_type, subject, entity_type, entity_id';
const VIEW = 'brevo_email_message_summary';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyScope<Q extends { gte: any; lt: any; eq: any; or: any }>(query: Q, period: Period, values: Pick<AnalyticsValues, 'tenant' | 'category'>): Q {
  let q = query.gte('first_event_at', period.fromIso).lt('first_event_at', period.toIso);
  // Food scope: ledger-linked or tagged with one of our notification types (the Brevo account is shared).
  q = q.or(`delivery_id.not.is.null,tags.ov.{${FOOD_EMAIL_TAGS.join(',')}}`);
  if (values.tenant) q = q.eq('tenant_id', values.tenant);
  return q;
}

export interface AnalyticsData {
  period: Period;
  rows: EnrichedMessage[];
  /** More rows than MAX_ANALYTICS_ROWS: KPIs cover the most recent ones only. */
  truncated: boolean;
  /** Messages the ledger says Brevo accepted in the window / how many of them have at least one event. */
  coverage: { accepted: number; tracked: number } | null;
  firstEventEver: string | null;
}

export async function loadAnalytics(db: SupabaseClient, values: AnalyticsValues, now: Date = new Date()): Promise<AnalyticsData> {
  const period = resolvePeriod(values, now);
  const raw: MessageRow[] = [];
  let truncated = false;
  for (let offset = 0; offset < MAX_ANALYTICS_ROWS; offset += 1000) {
    const { data, error } = await applyScope(db.from(VIEW).select(COLUMNS), period, values)
      .order('first_event_at', { ascending: false }).range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as unknown as MessageRow[];
    raw.push(...page);
    if (page.length < 1000) break;
    if (offset + 1000 >= MAX_ANALYTICS_ROWS) truncated = true;
  }
  let rows = enrich(raw);
  if (values.category !== 'all') rows = rows.filter((row) => row.category === values.category);

  const first = await db.from('brevo_email_events').select('occurred_at').order('occurred_at', { ascending: true }).limit(1);
  const firstEventEver = (first.data?.[0] as { occurred_at: string } | undefined)?.occurred_at ?? null;

  // Ledger coverage: emails the platform handed to Brevo vs emails with at least one event.
  let coverage: AnalyticsData['coverage'] = null;
  try {
    let accepted = db.from('notification_deliveries').select('provider_message_id', { count: 'exact', head: true })
      .eq('channel', 'email').eq('transport', 'brevo').in('status', ['accepted', 'delivered'])
      .gte('created_at', period.fromIso).lt('created_at', period.toIso);
    if (values.tenant) accepted = accepted.eq('tenant_id', values.tenant);
    if (values.category !== 'all') accepted = accepted.in('notification_type', typesForCategory(values.category as EmailCategory));
    const { count, error } = await accepted;
    if (!error && count !== null) {
      const ledgerTracked = new Set(rows.filter((row) => row.delivery_id !== null).map((row) => row.message_id)).size;
      coverage = { accepted: count, tracked: ledgerTracked };
    }
  } catch { /* coverage is informative only */ }

  return { period, rows, truncated, coverage, firstEventEver };
}

// ─── Event table ────────────────────────────────────────────────────────────

export function matchesEventFilter(row: EnrichedMessage, event: AnalyticsValues['event']): boolean {
  switch (event) {
    case 'delivered': return row.delivered;
    case 'opened': return row.openKind === 'human_likely' || row.openKind === 'suspicious';
    case 'clicked': return row.clicked;
    case 'failed': return row.undelivered;
    case 'error': return row.has_error;
    case 'no_open': return row.delivered && row.openKind === 'none';
    default: return true;
  }
}

export type MessageStatus = 'failed' | 'error' | 'delivered' | 'sent' | 'deferred' | 'unknown';

export function messageStatus(row: EnrichedMessage): MessageStatus {
  if (row.undelivered) return 'failed';
  if (row.delivered) return 'delivered';
  if (row.has_error) return 'error';
  if (row.has_deferred) return 'deferred';
  return row.sent_at ? 'sent' : 'unknown';
}

export function paginate(rows: readonly EnrichedMessage[], values: Pick<AnalyticsValues, 'page' | 'pageSize'>): { rows: EnrichedMessage[]; window: PageWindow } {
  const window = pageWindow(rows.length, values.page, values.pageSize);
  return { rows: rows.slice(window.rangeFrom, window.rangeTo + 1), window };
}
