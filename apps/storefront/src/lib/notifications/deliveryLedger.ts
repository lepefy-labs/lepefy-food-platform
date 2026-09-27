import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Notification delivery ledger (migration 136, `notification_deliveries`).
 *
 * A notification sent with ledger options is recorded, tried immediately and,
 * on failure, retried by POST /api/internal/notifications/dispatch with
 * backoff. The payload is cleared once n8n accepted it. Without migration 136
 * the send falls back to a direct call, so nothing is ever lost because of the
 * ledger itself.
 */
export interface LedgerOptions {
  tenantId: string;
  /** Stable per logical message: the same key is recorded (and sent) once per tenant. */
  idempotencyKey: string;
  notificationType: string;
}

export type RawSend = (webhookPath: string, payload: Record<string, unknown>) => Promise<boolean>;

export interface DeliveryRow {
  id: string;
  tenant_id: string;
  webhook_path: string;
  payload: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
}

const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const LOCK_MINUTES = 2;
const RETENTION_DAYS = 90;

export function retryDelayMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1]!;
}

function isMissingLedger(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || /notification_deliveries/.test(error.message ?? ''));
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

export async function recordAttemptResult(db: SupabaseClient, row: Pick<DeliveryRow, 'id' | 'attempts' | 'max_attempts'>, ok: boolean, error?: string) {
  const now = new Date();
  const update = ok
    ? { status: 'accepted', accepted_at: now.toISOString(), payload: null, locked_until: null, last_error: null, updated_at: now.toISOString() }
    : {
      status: row.attempts >= row.max_attempts ? 'dead' : 'failed',
      next_attempt_at: new Date(now.getTime() + retryDelayMinutes(row.attempts) * 60_000).toISOString(),
      locked_until: null,
      last_error: (error ?? 'n8n_not_accepted').slice(0, 500),
      updated_at: now.toISOString(),
    };
  const { error: updateError } = await db.from('notification_deliveries').update(update).eq('id', row.id);
  if (updateError) console.error('[deliveryLedger] result not recorded — delivery:', row.id, updateError);
}

/** Records the notification, sends it once now and schedules retries on failure. */
export async function sendWithLedger(
  webhookPath: string,
  payload: Record<string, unknown>,
  options: LedgerOptions,
  send: RawSend,
  db: SupabaseClient = createServiceClient(),
): Promise<boolean> {
  const { subject, recipients } = summarizePayload(payload);
  const { data, error } = await db.from('notification_deliveries').upsert({
    tenant_id: options.tenantId,
    idempotency_key: options.idempotencyKey,
    notification_type: options.notificationType,
    webhook_path: webhookPath,
    payload,
    subject,
    recipients,
    status: 'processing',
    attempts: 1,
    locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(),
  }, { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: true }).select('id, attempts, max_attempts');

  if (error) {
    if (!isMissingLedger(error)) console.error('[deliveryLedger] record failed, sending without ledger:', error);
    return send(webhookPath, payload);
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

  let ok = false;
  let failure: string | undefined;
  try {
    ok = await send(webhookPath, payload);
  } catch (sendError) {
    failure = sendError instanceof Error ? sendError.message : 'send_error';
  }
  await recordAttemptResult(db, row, ok, failure);
  return ok;
}

/** Scheduler entry point: retries due deliveries and purges old accepted rows. */
export async function dispatchDueDeliveries(send: RawSend, db: SupabaseClient = createServiceClient(), limit = 20) {
  const { data, error } = await db.rpc('claim_notification_deliveries', { p_limit: limit });
  if (error) throw error;
  const rows = (data ?? []) as DeliveryRow[];
  let accepted = 0;
  let failed = 0;
  for (const row of rows) {
    let ok = false;
    let failure: string | undefined;
    try {
      ok = row.payload ? await send(row.webhook_path, row.payload) : false;
    } catch (sendError) {
      failure = sendError instanceof Error ? sendError.message : 'send_error';
    }
    await recordAttemptResult(db, row, ok, failure);
    if (ok) accepted += 1; else failed += 1;
  }
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const { error: purgeError } = await db.from('notification_deliveries').delete()
    .in('status', ['accepted', 'dead']).lt('updated_at', cutoff);
  if (purgeError) console.error('[deliveryLedger] retention purge failed:', purgeError);
  return { claimed: rows.length, accepted, failed };
}
