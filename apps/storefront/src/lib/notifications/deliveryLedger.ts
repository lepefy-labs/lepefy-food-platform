import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import type { TransportResult } from '@/lib/notifications/emailTransport';

/**
 * Notification delivery ledger (migrations 136/137, `notification_deliveries`).
 *
 * mode 'retry' (default): the notification is recorded, tried immediately
 * and, on failure, retried by POST /api/internal/notifications/dispatch with
 * backoff. The payload is cleared once the transport accepted it.
 * mode 'log': recorded for the admin history only (no payload, no retry) for
 * flows that own their dedup/retry state; a new attempt with the same key
 * updates the same row.
 * Without migration 136 the send falls back to a direct call, so nothing is
 * ever lost because of the ledger itself.
 */
export interface LedgerOptions {
  tenantId: string;
  /** Stable per logical message: the same key is recorded (and sent) once per tenant. */
  idempotencyKey: string;
  notificationType: string;
  mode?: 'retry' | 'log';
}

export type RawSend = (webhookPath: string, payload: Record<string, unknown>) => Promise<boolean | TransportResult>;

export interface DeliveryRow {
  id: string;
  tenant_id: string;
  webhook_path: string;
  payload: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
}

interface Outcome { ok: boolean; error?: string; messageId?: string | null; transport?: string }

const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const LOCK_MINUTES = 2;
const RETENTION_DAYS = 90;

export function retryDelayMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1]!;
}

function isMissingLedger(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || /notification_deliveries/.test(error.message ?? ''));
}

function toOutcome(result: boolean | TransportResult | Outcome): Outcome {
  return typeof result === 'boolean' ? { ok: result } : result;
}

async function attempt(send: RawSend, webhookPath: string, payload: Record<string, unknown>): Promise<Outcome> {
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

export async function recordAttemptResult(
  db: SupabaseClient,
  row: Pick<DeliveryRow, 'id' | 'attempts' | 'max_attempts'>,
  result: boolean | TransportResult | Outcome,
  error?: string,
) {
  const outcome = toOutcome(result);
  const now = new Date();
  const update = outcome.ok
    ? { status: 'accepted', accepted_at: now.toISOString(), payload: null, locked_until: null, last_error: null, updated_at: now.toISOString() }
    : {
      status: row.attempts >= row.max_attempts ? 'dead' : 'failed',
      next_attempt_at: new Date(now.getTime() + retryDelayMinutes(row.attempts) * 60_000).toISOString(),
      locked_until: null,
      last_error: (outcome.error ?? error ?? 'not_accepted').slice(0, 500),
      updated_at: now.toISOString(),
    };
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
    return existing?.status === 'accepted';
  }

  const outcome = await attempt(send, webhookPath, payload);
  await recordAttemptResult(db, row, outcome);
  return outcome.ok;
}

/** Scheduler entry point: retries due deliveries and purges old accepted rows. */
export async function dispatchDueDeliveries(send: RawSend, db: SupabaseClient = createServiceClient(), limit = 20) {
  const { data, error } = await db.rpc('claim_notification_deliveries', { p_limit: limit });
  if (error) throw error;
  const rows = (data ?? []) as DeliveryRow[];
  let accepted = 0;
  let failed = 0;
  for (const row of rows) {
    const outcome = row.payload ? await attempt(send, row.webhook_path, row.payload) : { ok: false, error: 'payload_missing' };
    await recordAttemptResult(db, row, outcome);
    if (outcome.ok) accepted += 1; else failed += 1;
  }
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const { error: purgeError } = await db.from('notification_deliveries').delete()
    .in('status', ['accepted', 'dead']).lt('updated_at', cutoff);
  if (purgeError) console.error('[deliveryLedger] retention purge failed:', purgeError);
  return { claimed: rows.length, accepted, failed };
}
