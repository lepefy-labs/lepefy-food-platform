import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Brevo transactional webhook events (docs/BREVO_EMAIL_ANALYTICS.md): pure
 * parsing, privacy, dedupe and classification. No I/O, no `@/` alias, so the
 * unit tests and the route share exactly the same rules.
 */

export const BREVO_EVENTS = [
  'sent', 'delivered', 'first_open', 'open', 'proxy_open', 'click',
  'soft_bounce', 'hard_bounce', 'blocked', 'invalid', 'spam', 'deferred', 'error', 'unsubscribed',
] as const;
export type BrevoEventName = (typeof BREVO_EVENTS)[number];

/** Brevo payload `event` value → normalised name. Unknown values are ignored. */
const EVENT_ALIASES: Record<string, BrevoEventName> = {
  request: 'sent', sent: 'sent',
  delivered: 'delivered',
  unique_opened: 'first_open', first_opening: 'first_open',
  opened: 'open', open: 'open',
  proxy_open: 'proxy_open', loaded_by_proxy: 'proxy_open', loadedbyproxy: 'proxy_open', unique_proxy_open: 'proxy_open',
  click: 'click', clicked: 'click',
  soft_bounce: 'soft_bounce', softbounce: 'soft_bounce',
  hard_bounce: 'hard_bounce', hardbounce: 'hard_bounce',
  blocked: 'blocked',
  invalid_email: 'invalid', invalid: 'invalid',
  spam: 'spam', complaint: 'spam',
  deferred: 'deferred',
  error: 'error',
  unsubscribed: 'unsubscribed',
};

export function normalizeBrevoEvent(raw: unknown): BrevoEventName | null {
  if (typeof raw !== 'string') return null;
  return EVENT_ALIASES[raw.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null;
}

export interface ParsedBrevoEvent {
  event: BrevoEventName;
  rawEvent: string;
  messageId: string;
  email: string;
  occurredAt: Date;
  tags: string[];
  templateId: number | null;
  reason: string | null;
  linkHost: string | null;
}

export type ParseResult =
  | { ok: true; value: ParsedBrevoEvent }
  | { ok: false; reason: 'not_an_object' | 'unknown_event' | 'missing_message_id' | 'missing_email' | 'invalid_date' };

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Brevo sends seconds (`ts_epoch` in ms, `ts_event`/`ts` in s) or a local date string. */
export function brevoEventDate(payload: Record<string, unknown>, now: Date = new Date()): Date | null {
  const candidates: Array<[unknown, 'ms' | 's']> = [[payload.ts_epoch, 'ms'], [payload.ts_event, 's'], [payload.ts, 's']];
  for (const [value, unit] of candidates) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{9,13}$/.test(value) ? Number(value) : NaN;
    if (!Number.isFinite(n) || n <= 0) continue;
    const date = new Date(unit === 's' && n < 1e11 ? n * 1000 : n);
    if (!Number.isNaN(date.getTime())) return clampFuture(date, now);
  }
  const text = str(payload.date);
  if (text) {
    const date = new Date(text.includes('T') ? text : text.replace(' ', 'T') + 'Z');
    if (!Number.isNaN(date.getTime())) return clampFuture(date, now);
  }
  return null;
}

/** A clock skew of a few minutes is normal; anything further in the future is not a real event time. */
function clampFuture(date: Date, now: Date): Date | null {
  return date.getTime() > now.getTime() + 24 * 3_600_000 ? null : date;
}

/** Masks anything that looks like an e-mail address inside free text, then truncates. */
export function sanitizeReason(value: unknown, max = 200): string | null {
  const text = str(value);
  if (!text) return null;
  return text.replace(/[^\s@,;<>"']+@[^\s@,;<>"']+/g, '[email]').replace(/\s+/g, ' ').slice(0, max);
}

/** `j***@example.com` — enough to recognise a mailbox in support, not enough to contact it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.toLowerCase().split('@');
  return `${local.slice(0, 1)}***@${domain}`.slice(0, 120);
}

/** Never keeps a path or query (they may carry tokens): host only. */
export function linkHost(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  try { return new URL(text).hostname.slice(0, 120) || null; } catch { return null; }
}

function parseTags(payload: Record<string, unknown>): string[] {
  const raw = Array.isArray(payload.tags) ? payload.tags : payload.tag !== undefined ? [payload.tag] : [];
  const flat = raw.flatMap((item) => (typeof item === 'string' ? item.split(',') : []));
  return [...new Set(flat.map((tag) => tag.trim().slice(0, 80)).filter(Boolean))].slice(0, 10);
}

export function parseBrevoEvent(payload: unknown, now: Date = new Date()): ParseResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'not_an_object' };
  const body = payload as Record<string, unknown>;
  const rawEvent = str(body.event);
  const event = normalizeBrevoEvent(rawEvent);
  if (!event || !rawEvent) return { ok: false, reason: 'unknown_event' };
  const messageId = str(body['message-id']) ?? str(body.message_id) ?? str(body.messageId);
  if (!messageId || messageId.length > 300) return { ok: false, reason: 'missing_message_id' };
  const email = str(body.email)?.toLowerCase() ?? null;
  if (!email || !EMAIL.test(email)) return { ok: false, reason: 'missing_email' };
  const occurredAt = brevoEventDate(body, now);
  if (!occurredAt) return { ok: false, reason: 'invalid_date' };
  const template = typeof body.template_id === 'number' ? body.template_id : Number(body.template_id);
  return {
    ok: true,
    value: {
      event,
      rawEvent: rawEvent.slice(0, 40),
      messageId,
      email,
      occurredAt,
      tags: parseTags(body),
      templateId: Number.isInteger(template) && template > 0 ? template : null,
      reason: sanitizeReason(body.reason),
      linkHost: event === 'click' ? linkHost(body.link) : null,
    },
  };
}

/**
 * Brevo uses ONE message-id for every recipient of a send, so a message is
 * (message-id, recipient). The recipient is an HMAC: the address is never stored.
 */
export function recipientHash(email: string, secret: string): string {
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Dedupe key: a provider retry (same message, recipient, event and provider
 * timestamp) maps to the same key; a second real open or click has another
 * timestamp and is a new row.
 */
export function eventKey(messageId: string, hash: string, event: BrevoEventName, occurredAt: Date): string {
  return createHash('sha256').update(`${messageId}\n${hash}\n${event}\n${occurredAt.getTime()}`).digest('hex');
}

/**
 * `Authorization: Bearer <BREVO_WEBHOOK_TOKEN>` (or the bare token: Brevo's
 * "Token" authentication does not document the exact header form), constant
 * time. Fails closed when the token is not configured or is too short to be a
 * real secret.
 */
export function isAuthorizedBrevoWebhook(authorization: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 24 || !authorization) return false;
  const received = authorization.trim().replace(/^Bearer\s+/i, '').trim();
  if (!received) return false;
  const a = createHash('sha256').update(received).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Shape of a rejected Authorization header for the logs: never the value. */
export function describeAuthorization(authorization: string | null): { present: boolean; scheme: string | null; length: number } {
  if (!authorization) return { present: false, scheme: null, length: 0 };
  const scheme = /^([A-Za-z]+)\s+\S/.exec(authorization.trim())?.[1] ?? null;
  return { present: true, scheme, length: authorization.trim().length };
}

// ─── Categories ─────────────────────────────────────────────────────────────

export const EMAIL_CATEGORIES = [
  'reservation_confirmation', 'payment_confirmation', 'order_confirmation', 'shipping_update',
  'order_completed', 'reminder', 'review_request', 'other_food',
] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const EMAIL_CATEGORY_LABELS: Record<EmailCategory, string> = {
  reservation_confirmation: 'Confirmations de réservation',
  payment_confirmation: 'Confirmations de paiement',
  order_confirmation: 'Confirmations de commande',
  shipping_update: 'Suivi d’expédition',
  order_completed: 'Commandes terminées',
  reminder: 'Rappels',
  review_request: 'Demandes d’avis',
  other_food: 'Autres communications Food',
};

/**
 * Category by notification type (the ledger `notification_type`, also the Brevo
 * tag set by sendViaBrevo) — never by subject. A type not listed is "other_food"
 * but still a Food email; an email with no known type and no ledger row is
 * out of scope (see isFoodEmail).
 */
export const NOTIFICATION_TYPE_CATEGORY: Record<string, EmailCategory> = {
  event_reservation_confirmed: 'reservation_confirmation',
  rental_reservation_confirmed_customer: 'reservation_confirmation',
  card_quick_payment_customer: 'payment_confirmation',
  order_confirmed: 'order_confirmation',
  order_shipped: 'shipping_update',
  order_ready_for_pickup: 'shipping_update',
  order_completed: 'order_completed',
  payment_reminder: 'reminder',
  review_invite: 'review_request',
};

/** Types sent by this platform (customer or staff): the scope of the dashboard. */
export const FOOD_NOTIFICATION_TYPES: readonly string[] = [
  ...Object.keys(NOTIFICATION_TYPE_CATEGORY),
  'order_cancelled', 'order_stock_conflict', 'card_quick_payment', 'event_capacity_conflict', 'rental_stock_conflict',
  'service_inquiry_created', 'rental_reservation_confirmed_admin', 'rental_delivery_quote_pending',
  'external_payment_awaiting_verification', 'event_external_payment_awaiting_verification',
  'tester_feedback_invite', 'event_booking_closed_reports', 'marketing_campaign', 'daily_order_digest',
  'order_created', 'external_payment_pending', 'order_attention_required', 'shipment_creation_failed',
  'shipment_action_required', 'shipment_delayed', 'service_inquiries', 'rental_reservations',
  'event_reservation_created', 'subscription_billing', 'order_backlog_summary', 'staff_test', 'notification',
];

export interface ClassifyInput { notificationType: string | null; tags: readonly string[] | null; hasLedgerMatch: boolean }

/** Resolves the notification type: ledger first, then a known Food tag. */
export function resolveNotificationType({ notificationType, tags }: Pick<ClassifyInput, 'notificationType' | 'tags'>): string | null {
  if (notificationType) return notificationType;
  return (tags ?? []).find((tag) => FOOD_NOTIFICATION_TYPES.includes(tag)) ?? null;
}

/**
 * The Brevo account is shared with other Lepefy projects: only an email linked
 * to this platform's ledger, or tagged with one of our notification types, is Food.
 */
export function isFoodEmail(input: ClassifyInput): boolean {
  return input.hasLedgerMatch || resolveNotificationType(input) !== null;
}

export function classifyEmail(input: ClassifyInput): EmailCategory | null {
  if (!isFoodEmail(input)) return null;
  const type = resolveNotificationType(input);
  return (type && NOTIFICATION_TYPE_CATEGORY[type]) || 'other_food';
}

/** Notification types of a category (for server-side filters). `other_food` is the complement. */
export function typesForCategory(category: EmailCategory): string[] {
  if (category === 'other_food') return FOOD_NOTIFICATION_TYPES.filter((type) => !(type in NOTIFICATION_TYPE_CATEGORY));
  return Object.entries(NOTIFICATION_TYPE_CATEGORY).filter(([, value]) => value === category).map(([type]) => type);
}
