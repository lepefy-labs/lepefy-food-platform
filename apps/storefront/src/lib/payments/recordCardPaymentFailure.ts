import { createServiceClient } from '@/lib/supabase/server';
import { paymentFailureDetail } from './cardCartOutcome';

interface FailedIntent {
  id: string;
  metadata?: Record<string, string> | null;
  last_payment_error?: { code?: string | null; decline_code?: string | null; type?: string | null; payment_method?: { type?: string | null } | null } | null;
}

/**
 * Webhook Stripe `payment_intent.payment_failed` : enregistre le refus sur la
 * session de checkout (évènement `payment_failed_server` de
 * `payment_funnel_logs`, déjà prévu par le schéma), pour que la fiche « Panier
 * carte » et le funnel distinguent un refus d'un abandon.
 *
 * Session et tenant : métadonnées du PaymentIntent posées par /api/checkout,
 * sinon recherche par `stripe_payment_intent_id`. Idempotent par évènement
 * Stripe (un rejeu ne crée pas de doublon). Fail-open : ne lève jamais, une
 * erreur ici ne fait jamais échouer le webhook.
 */
export async function recordCardPaymentFailure(intent: FailedIntent, eventId: string): Promise<void> {
  try {
    const service = createServiceClient();
    let sessionId = intent.metadata?.session_id ?? null;
    let tenantId = intent.metadata?.tenant_id ?? null;
    if (!sessionId || !tenantId) {
      const { data } = await service.from('checkout_sessions')
        .select('id, tenant_id').eq('stripe_payment_intent_id', intent.id).maybeSingle();
      const row = data as { id: string; tenant_id: string } | null;
      if (!row) return;
      sessionId = row.id;
      tenantId = row.tenant_id;
    }

    const { data: existing } = await service.from('payment_funnel_logs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('reference_id', sessionId)
      .eq('event_type', 'payment_failed_server')
      .eq('detail->>stripe_event_id', eventId)
      .limit(1);
    if ((existing ?? []).length > 0) return;

    const { error } = await service.from('payment_funnel_logs').insert({
      tenant_id: tenantId,
      module: 'shop',
      reference_id: sessionId,
      event_type: 'payment_failed_server',
      detail: paymentFailureDetail({ eventId, paymentIntentId: intent.id, lastPaymentError: intent.last_payment_error }),
    });
    if (error) console.warn('[webhook] payment failure not recorded — intent:', intent.id, '— code:', error.code);
  } catch {
    console.warn('[webhook] payment failure not recorded — intent:', intent.id);
  }
}
