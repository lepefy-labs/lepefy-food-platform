import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import type { SimulatedMessageDraft } from '@/lib/demo/simulatedMessageFormat';

/**
 * Accès base de la démo (tables 167, service role). Rien ici ne lève : la
 * démo ne doit jamais casser un parcours parce qu'un compteur a échoué —
 * sauf la limite de fréquence, qui refuse en cas de doute (protection des coûts).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordSimulatedMessage(tenantId: unknown, draft: SimulatedMessageDraft): Promise<void> {
  try {
    const { error } = await createServiceClient().from('demo_simulated_messages').insert({
      tenant_id: typeof tenantId === 'string' && UUID.test(tenantId) ? tenantId : null,
      channel: draft.channel,
      kind: draft.kind,
      recipient_hint: draft.recipientHint,
      subject: draft.subject,
      preview: draft.preview,
    });
    if (error) console.warn('[demo] simulated message not recorded:', error.message);
  } catch (error) {
    console.warn('[demo] simulated message not recorded:', error);
  }
}

/** Clé de limite sans IP en clair : empreinte tronquée, propre à la démo. */
export function demoBucket(prefix: string, ip: string): string {
  const digest = createHash('sha256').update(`lepefy-demo:${ip}`).digest('hex').slice(0, 20);
  return `${prefix}:${digest}`;
}

/** true = autorisé. Erreur ou migration absente = refusé. */
export async function demoRateAllowed(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().rpc('demo_rate_hit', {
      p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds,
    });
    if (error) {
      console.warn('[demo] rate limit unavailable, refused:', error.message);
      return false;
    }
    return data === true;
  } catch (error) {
    console.warn('[demo] rate limit unavailable, refused:', error);
    return false;
  }
}

export const DEMO_EVENT_KEYS = [
  'landing.view', 'path.shop', 'path.events', 'path.orders', 'path.management', 'path.nala',
  'visit.started', 'visit.refused', 'tour.step', 'tour.completed', 'tour.closed',
  'request.opened', 'request.sent', 'messages.view',
] as const;
export type DemoEventKey = (typeof DEMO_EVENT_KEYS)[number];

export function isDemoEventKey(value: unknown): value is DemoEventKey {
  return typeof value === 'string' && (DEMO_EVENT_KEYS as readonly string[]).includes(value);
}

export async function countDemoEvent(key: DemoEventKey): Promise<void> {
  try {
    const { error } = await createServiceClient().rpc('demo_count_event', { p_event: key });
    if (error) console.warn('[demo] event not counted:', error.message);
  } catch (error) {
    console.warn('[demo] event not counted:', error);
  }
}
