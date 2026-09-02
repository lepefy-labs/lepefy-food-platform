import type { SupabaseClient } from '@supabase/supabase-js';
import { hasTenantFeature, PLATFORM_FEATURE_KEYS } from '@/lib/entitlements/tenantEntitlements';
import {
  NALA_ATTRIBUTION_MODEL,
  isUuid,
  selectQualifyingNalaAttributions,
  type NalaAttributionCandidate,
  type NalaInteractionSnapshot,
  type ResolvedNalaAttribution,
} from '@/lib/ai/nalaAttributionCore';

export interface ServerCheckoutItem {
  productId: string;
  price: number;
  quantity: number;
}

function cleanCandidates(value: unknown): NalaAttributionCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    return isUuid(item.productId) && isUuid(item.interactionId) && isUuid(item.clientSessionId)
      ? [{ productId: item.productId, interactionId: item.interactionId, clientSessionId: item.clientSessionId }]
      : [];
  });
}

export async function resolveNalaAttributions(params: {
  supabase: SupabaseClient;
  tenantId: string;
  candidates: unknown;
  cartProductIds: string[];
}): Promise<ResolvedNalaAttribution[]> {
  const candidates = cleanCandidates(params.candidates);
  if (candidates.length === 0) return [];

  try {
    const entitled = await hasTenantFeature(
      params.tenantId,
      PLATFORM_FEATURE_KEYS.nalaConversionAttribution,
    );
    if (!entitled) return [];

    const interactionIds = [...new Set(candidates.map((candidate) => candidate.interactionId))];
    const { data, error } = await params.supabase
      .from('nala_interactions')
      .select('id, session_id, matched_product_ids, created_at')
      .eq('tenant_id', params.tenantId)
      .in('id', interactionIds);

    if (error) throw new Error(error.message);

    const interactionRows = (data ?? []) as Array<Omit<NalaInteractionSnapshot, 'client_session_id'>>;
    const sessionIds = [...new Set(interactionRows.map((interaction) => interaction.session_id))];
    const { data: sessions, error: sessionsError } = await params.supabase
      .from('nala_sessions')
      .select('id, client_session_id')
      .eq('tenant_id', params.tenantId)
      .in('id', sessionIds);
    if (sessionsError) throw new Error(sessionsError.message);

    const clientSessionById = new Map((sessions ?? []).map((session) => [session.id, session.client_session_id]));
    const interactions: NalaInteractionSnapshot[] = interactionRows.flatMap((interaction) => {
      const clientSessionId = clientSessionById.get(interaction.session_id);
      return isUuid(clientSessionId) ? [{ ...interaction, client_session_id: clientSessionId }] : [];
    });

    return selectQualifyingNalaAttributions({
      entitled,
      candidates,
      interactions,
      cartProductIds: params.cartProductIds,
    });
  } catch (error) {
    console.error('[nala-attribution] Resolution failed closed.', {
      tenantId: params.tenantId,
      error,
    });
    return [];
  }
}

export async function recordNalaCheckoutStarted(params: {
  supabase: SupabaseClient;
  tenantId: string;
  checkoutSessionId: string;
  candidates: unknown;
  items: ServerCheckoutItem[];
  currency: string;
}): Promise<void> {
  try {
    const resolved = await resolveNalaAttributions({
      supabase: params.supabase,
      tenantId: params.tenantId,
      candidates: params.candidates,
      cartProductIds: params.items.map((item) => item.productId),
    });
    if (resolved.length === 0) return;

    const itemByProduct = new Map(params.items.map((item) => [item.productId, item]));
    const occurredAt = new Date().toISOString();
    const lineageRows = resolved.map((attribution) => ({
      checkout_session_id: params.checkoutSessionId,
      tenant_id: params.tenantId,
      product_id: attribution.productId,
      nala_session_id: attribution.sessionId,
      nala_interaction_id: attribution.interactionId,
      attribution_model: NALA_ATTRIBUTION_MODEL,
      attributed_at: occurredAt,
    }));
    const eventRows = resolved.flatMap((attribution) => {
      const item = itemByProduct.get(attribution.productId);
      if (!item) return [];
      return [{
        tenant_id: params.tenantId,
        nala_session_id: attribution.sessionId,
        nala_interaction_id: attribution.interactionId,
        event_type: 'checkout_started',
        product_id: attribution.productId,
        checkout_session_id: params.checkoutSessionId,
        quantity: item.quantity,
        unit_price: item.price,
        currency: params.currency.toUpperCase(),
        attribution_model: NALA_ATTRIBUTION_MODEL,
        idempotency_key: `checkout:${params.checkoutSessionId}:${attribution.productId}`,
        occurred_at: occurredAt,
      }];
    });

    const { error: lineageError } = await params.supabase
      .from('nala_checkout_attributions')
      .upsert(lineageRows, { onConflict: 'checkout_session_id,product_id' });
    if (lineageError) throw new Error(lineageError.message);

    const { error: eventError } = await params.supabase
      .from('nala_conversion_events')
      .upsert(eventRows, { onConflict: 'tenant_id,idempotency_key' });
    if (eventError) throw new Error(eventError.message);
  } catch (error) {
    console.error('[nala-attribution] Checkout analytics write failed; checkout is unaffected.', {
      tenantId: params.tenantId,
      checkoutSessionId: params.checkoutSessionId,
      error,
    });
  }
}

export async function recordNalaPurchaseAttribution(params: {
  supabase: SupabaseClient;
  checkoutSessionId: string;
  orderId: string;
}): Promise<void> {
  try {
    const { error } = await params.supabase.rpc('record_nala_purchase_attribution', {
      p_checkout_session_id: params.checkoutSessionId,
      p_order_id: params.orderId,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error('[nala-attribution] Purchase analytics write failed; order is unaffected.', {
      checkoutSessionId: params.checkoutSessionId,
      orderId: params.orderId,
      error,
    });
  }
}
