import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getGreenApiMessageStatus, readGreenApiOutboundConfig, type GreenApiMessageStatus, type GreenApiOutboundConfig,
} from '@/lib/notifications/providers/greenApiOutbound';
import { retryDelayMinutes } from '@/lib/notifications/deliveryLedger';

/**
 * Second half of the scheduler tick for WhatsApp rows (migration 158):
 * 1. a send interrupted while `processing` (crash, timeout of the function)
 *    becomes `unknown`: Green API has no idempotency key, so it is never
 *    resent blindly;
 * 2. accepted messages are checked in the Green API journal (getMessage):
 *    `delivered`/`read` → delivered (the payload is cleared), `failed` → a
 *    normal retry. `read` is stored as provider status only: reading is never
 *    assumed from acceptance.
 */

const STALE_PROCESSING_MS = 3 * 60_000;
const CHECK_EVERY_MS = 10 * 60_000;
const CHECK_WINDOW_MS = 48 * 3_600_000;

export interface FollowUpDeps {
  config: GreenApiOutboundConfig | null;
  status: (config: GreenApiOutboundConfig, input: { phone: string; messageId: string }) => Promise<GreenApiMessageStatus | null>;
  now: () => Date;
}

export function defaultFollowUpDeps(): FollowUpDeps {
  const config = readGreenApiOutboundConfig();
  return { config: config.ok ? config.config : null, status: getGreenApiMessageStatus, now: () => new Date() };
}

/** Ledger update for an observed provider status (pure, unit-tested). */
export function followUpUpdate(row: { attempts: number; max_attempts: number }, status: GreenApiMessageStatus | null, now: Date): Record<string, unknown> {
  const at = now.toISOString();
  if (status === 'delivered' || status === 'read') {
    return { status: 'delivered', delivered_at: at, provider_status: status, provider_checked_at: at, payload: null, updated_at: at };
  }
  if (status === 'failed') {
    return {
      status: row.attempts >= row.max_attempts ? 'dead' : 'failed', provider_status: status, provider_checked_at: at,
      last_error: 'provider_failed', next_attempt_at: new Date(now.getTime() + retryDelayMinutes(row.attempts) * 60_000).toISOString(), updated_at: at,
    };
  }
  return { provider_status: status ?? null, provider_checked_at: at };
}

export async function followUpWhatsappDeliveries(db: SupabaseClient, deps: FollowUpDeps = defaultFollowUpDeps(), limit = 20) {
  const now = deps.now();
  const { data: stale } = await db.from('notification_deliveries')
    .update({ status: 'unknown', last_error: 'interrupted', locked_until: null, updated_at: now.toISOString() })
    .eq('channel', 'whatsapp').eq('status', 'processing').lt('locked_until', new Date(now.getTime() - STALE_PROCESSING_MS + 2 * 60_000).toISOString())
    .select('id');

  let checked = 0;
  let delivered = 0;
  if (deps.config) {
    const { data } = await db.from('notification_deliveries')
      .select('id, payload, provider_message_id, attempts, max_attempts, provider_checked_at, accepted_at')
      .eq('channel', 'whatsapp').eq('status', 'accepted').not('provider_message_id', 'is', null)
      .gte('accepted_at', new Date(now.getTime() - CHECK_WINDOW_MS).toISOString())
      .or(`provider_checked_at.is.null,provider_checked_at.lt.${new Date(now.getTime() - CHECK_EVERY_MS).toISOString()}`)
      .order('accepted_at', { ascending: true }).limit(limit);
    for (const row of (data ?? []) as Array<{ id: string; payload: { to?: unknown } | null; provider_message_id: string; attempts: number; max_attempts: number }>) {
      const phone = typeof row.payload?.to === 'string' ? row.payload.to : null;
      if (!phone) continue;
      const status = await deps.status(deps.config, { phone, messageId: row.provider_message_id });
      checked += 1;
      const update = followUpUpdate(row, status, now);
      if (update.status === 'delivered') delivered += 1;
      await db.from('notification_deliveries').update(update).eq('id', row.id).eq('status', 'accepted');
    }
  }
  // Number + text are not kept beyond the check window.
  await db.from('notification_deliveries').update({ payload: null })
    .eq('channel', 'whatsapp').eq('status', 'accepted').lt('accepted_at', new Date(now.getTime() - CHECK_WINDOW_MS).toISOString())
    .not('payload', 'is', null);
  return { interrupted: (stale ?? []).length, checked, delivered };
}
