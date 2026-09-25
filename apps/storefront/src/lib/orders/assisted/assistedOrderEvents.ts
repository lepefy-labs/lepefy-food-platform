import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssistedOrderEventType } from '@lepefy/types';

export interface AssistedOrderEventInput {
  tenantId: string;
  checkoutSessionId: string;
  eventType: AssistedOrderEventType;
  actorType: 'admin' | 'customer' | 'system';
  actorAdminId?: string | null;
  orderId?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Journal append-only des commandes assistées. Best-effort : un échec
 * d'écriture d'historique ne bloque jamais un paiement ou une commande.
 * Ne jamais y placer de jeton de paiement, secret ou donnée bancaire.
 */
export async function recordAssistedOrderEvent(supabase: SupabaseClient, input: AssistedOrderEventInput): Promise<void> {
  const { error } = await supabase.from('assisted_order_events').insert({
    tenant_id: input.tenantId,
    checkout_session_id: input.checkoutSessionId,
    event_type: input.eventType,
    actor_type: input.actorType,
    actor_admin_id: input.actorAdminId ?? null,
    order_id: input.orderId ?? null,
    detail: input.detail ?? {},
  });
  if (error) console.warn('[assisted-order-events] append failed:', input.eventType, error.message);
}
