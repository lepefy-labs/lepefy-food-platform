import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import type { TransportResult } from '@/lib/notifications/emailTransport';

/**
 * Notification delivery ledger (migrations 136/137/158, `notification_deliveries`),
 * the single outbox of every channel.
 *
 * mode 'retry' (default): the notification is recorded, tried immediately
 * and, on failure, retried by POST /api/internal/notifications/dispatch with
 * backoff. The payload is cleared once the transport accepted it (WhatsApp:
 * once delivered, see whatsappFollowUp.ts).
 * mode 'log': recorded for the admin history only (no payload, no retry) for
 * flows that own their dedup/retry state; a new attempt with the same key
 * updates the same row.
 * Without migration 136 the send falls back to a direct call, so nothing is
 * ever lost because of the ledger itself.
 *
 * Statuses: pending (queued) → processing (sending) → accepted (provider took
 * it) → delivered (provider observed delivery, WhatsApp only); failed (retry
 * scheduled) → dead (abandoned); skipped (not sent on purpose); unknown (the
 * request may have reached the provider: never resent automatically).
 */
export interface LedgerOptions {
  tenantId: string;
  /** Stable per logical message: the same key is recorded (and sent) once per tenant. */
  idempotencyKey: string;
  notificationType: string;
  mode?: 'retry' | 'log';
}

export type RawSend = (webhookPath: string, payload: Record<string, unknown>) => Promise<boolean | TransportResult | DeliveryOutcome>;

export interface DeliveryRow {
  id: string;
  tenant_id: string;
  webhook_path: string;
  payload: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
  channel?: string | null;
}

export interface DeliveryOutcome {
  ok: boolean;
  error?: string;
  messageId?: string | null;
  transport?: string;
  /** Not sent on purpose (test tenant, channel disabled). */
  skipped?: boolean;
  /** May have reached the provider: status unknown, no automatic retry. */
  uncertain?: boolean;
  /** Retrying cannot help: abandoned at once. */
  definitive?: boolean;
}

const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const LOCK_MINUTES = 2;
const RETENTION_DAYS = 90;
const WHATSAPP_SPACING_MS = 1500;

export const WHATSAPP_PATH_PREFIX = '/whatsapp/';

export function retryDelayMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1]!;
}

function isMissingLedger(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || /notification_deliveries/.test(error.message ?? ''));
}

function toOutcome(result: boolean | TransportResult | DeliveryOutcome): DeliveryOutcome {
  return typeof result === 'boolean' ? { ok: result } : result;
}

async function attempt(send: RawSend, webhookPath: string, payload: Record<string, unknown>): Promise<DeliveryOutcome> {
  try {
    return toOutcome(await send(webhookPath, payload));
  } catch (sendError) {
    return { ok: false, error: sendError instanceof Error ? sendError.message : 'send_error' };
  }
}

/** Subject and recipients kept for the admin history; the full payload is not. */
export function summarizePayload(payload: Record<string, unknown>): { subject: string | null; recipients: string[] } {
  const email = payload.email;
  const subject = typeof payload.subject === 'string' ? payload.subject
    : email && typeof email === 'object' && typeof (email as { subject?: unknown }).subject === 'string'
      ? (email as { subject: string }).subject : null;
  const candidates: unknown[] = Array.isArray(payload.recipients) ? payload.recipients
    : [typeof email === 'string' ? email : null, payload.customerEmail, payload.customer_email];
  const recipients = candidates.filter((value): value is string => typeof value === 'string' && value.includes('@')).slice(0, 20);
  return { subject: subject ? subject.slice(0, 300) : null, recipients };
}

/** Status update for one attempt (pure, unit-tested). */
export function attemptUpdate(
  row: Pick<DeliveryRow, 'attempts' | 'max_attempts' | 'webhook_path'>,
  outcome: DeliveryOutcome,
  now: Date = new Date(),
): Record<string, unknown> {
  const at = now.toISOString();
  const whatsapp = row.webhook_path?.startsWith(WHATSAPP_PATH_PREFIX) === true;
  if (outcome.ok && outcome.skipped && whatsapp) {
    return { status: 'skipped', payload: null, locked_until: null, last_error: (outcome.error ?? 'skipped').slice(0, 500), updated_at: at };
  }
  if (outcome.ok) {
    // WhatsApp keeps its payload (number + text) until the delivery check.
    return { status: 'accepted', accepted_at: at, ...(whatsapp ? {} : { payload: null }), locked_until: null, last_error: null, updated_at: at };
  }
  if (outcome.uncertain) {
    return { status: 'unknown', locked_until: null, last_error: (outcome.error ?? 'uncertain').slice(0, 500), updated_at: at };
  }
  return {
    status: outcome.definitive || row.attempts >= row.max_attempts ? 'dead' : 'failed',
    next_attempt_at: new Date(now.getTime() + retryDelayMinutes(row.attempts) * 60_000).toISOString(),
    locked_until: null,
    last_error: (outcome.error ?? 'not_accepted').slice(0, 500),
    updated_at: at,
  };
}

export async function recordAttemptResult(
  db: SupabaseClient,
  row: Pick<DeliveryRow, 'id' | 'attempts' | 'max_attempts'> & { webhook_path?: string },
  result: boolean | TransportResult | DeliveryOutcome,
  error?: string,
) {
  const outcome = toOutcome(result);
  const update = attemptUpdate({ attempts: row.attempts, max_attempts: row.max_attempts, webhook_path: row.webhook_path ?? '' },
    outcome.ok || outcome.error ? outcome : { ...outcome, error });
  const { error: updateError } = await db.from('notification_deliveries').update(update).eq('id', row.id);
  if (updateError) console.error('[deliveryLedger] result not recorded — delivery:', row.id, updateError);

  // Separate write (migration 137): a database without these columns must
  // never block the status update above, or the row would be sent again.
  if (outcome.transport || outcome.messageId) {
    const { error: metaError } = await db.from('notification_deliveries')
      .update({ transport: outcome.transport ?? null, provider_message_id: outcome.messageId ?? null }).eq('id', row.id);
    if (metaError && metaError.code !== '42703' && metaError.code !== 'PGRST204') {
      console.warn('[deliveryLedger] transport metadata not recorded — delivery:', row.id, metaError);
    }
  }
}

/** Records the notification, sends it once now and (mode 'retry') schedules retries on failure. */
export async function sendWithLedger(
  webhookPath: string,
  payload: Record<string, unknown>,
  options: LedgerOptions,
  send: RawSend,
  db: SupabaseClient = createServiceClient(),
): Promise<boolean> {
  const { subject, recipients } = summarizePayload(payload);
  const logOnly = options.mode === 'log';
  const { data, error } = await db.from('notification_deliveries').upsert({
    tenant_id: options.tenantId,
    idempotency_key: options.idempotencyKey,
    notification_type: options.notificationType,
    webhook_path: webhookPath,
    payload: logOnly ? null : payload,
    subject,
    recipients,
    status: 'processing',
    attempts: 1,
    ...(logOnly ? { max_attempts: 1, last_error: null, accepted_at: null } : {}),
    locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(),
  }, { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: !logOnly }).select('id, attempts, max_attempts');

  if (error) {
    if (!isMissingLedger(error)) console.error('[deliveryLedger] record failed, sending without ledger:', error);
    return (await attempt(send, webhookPath, payload)).ok;
  }
  const row = data?.[0] as Pick<DeliveryRow, 'id' | 'attempts' | 'max_attempts'> | undefined;
  if (!row) {
    // Same key already recorded: never send it twice. The existing row is
    // either accepted or owned by its own retry schedule.
    const { data: existing } = await db.from('notification_deliveries').select('status')
      .eq('tenant_id', options.tenantId).eq('idempotency_key', options.idempotencyKey).maybeSingle();
    console.info('[deliveryLedger] duplicate skipped —', options.idempotencyKey, '— status:', existing?.status);
    return existing?.status === 'accepted' || existing?.status === 'delivered';
  }

  const outcome = await attempt(send, webhookPath, payload);
  await recordAttemptResult(db, { ...row, webhook_path: webhookPath }, outcome);
  return outcome.ok;
}

/**
 * Sends one queued row now (dispatcher, catch-up), claimed with a
 * compare-and-set on `pending` so the scheduler can never send it too.
 */
export async function attemptQueuedDelivery(db: SupabaseClient, id: string, send: RawSend): Promise<DeliveryOutcome | null> {
  const { data: current } = await db.from('notification_deliveries').select('attempts').eq('id', id).eq('status', 'pending').maybeSingle();
  if (!current) return null;
  const attempts = (current as { attempts: number }).attempts + 1;
  const { data: claimed } = await db.from('notification_deliveries').update({
    status: 'processing', attempts, locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', id).eq('status', 'pending').eq('attempts', attempts - 1)
    .select('id, tenant_id, webhook_path, payload, attempts, max_attempts').maybeSingle();
  if (!claimed) return null;
  const row = claimed as DeliveryRow;
  const outcome = row.payload ? await attempt(send, row.webhook_path, row.payload) : { ok: false, error: 'payload_missing' };
  await recordAttemptResult(db, row, outcome);
  return outcome;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Scheduler entry point: retries due deliveries and purges old finished rows. */
export async function dispatchDueDeliveries(
  send: RawSend,
  db: SupabaseClient = createServiceClient(),
  limit = 20,
  pause: (ms: number) => Promise<void> = sleep,
) {
  const { data, error } = await db.rpc('claim_notification_deliveries', { p_limit: limit });
  if (error) throw error;
  const rows = (data ?? []) as DeliveryRow[];
  let accepted = 0;
  let failed = 0;
  let lastWhatsapp = 0;
  for (const row of rows) {
    // Provider rate limit: WhatsApp messages leave one by one, spaced.
    if (row.webhook_path.startsWith(WHATSAPP_PATH_PREFIX)) {
      const wait = lastWhatsapp + WHATSAPP_SPACING_MS - Date.now();
      if (lastWhatsapp && wait > 0) await pause(wait);
      lastWhatsapp = Date.now();
    }
    const outcome = row.payload ? await attempt(send, row.webhook_path, row.payload) : { ok: false, error: 'payload_missing' };
    await recordAttemptResult(db, row, outcome);
    if (outcome.ok) accepted += 1; else failed += 1;
  }
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const { error: purgeError } = await db.from('notification_deliveries').delete()
    .in('status', ['accepted', 'delivered', 'dead', 'skipped', 'unknown']).lt('updated_at', cutoff);
  if (purgeError) console.error('[deliveryLedger] retention purge failed:', purgeError);
  return { claimed: rows.length, accepted, failed };
}
