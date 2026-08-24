import type { SupabaseClient } from '@supabase/supabase-js';

export const CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

export function checkoutExpiryFromNow(now = new Date()): string {
  return new Date(now.getTime() + CHECKOUT_TTL_MS).toISOString();
}

export interface ActiveCheckoutPayload {
  email: string;
  full_name: string | null;
  phone: string | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: Record<string, unknown> | null;
  shipping_details: Record<string, unknown> | null;
  shipping_total: number;
  ambassador_discount_amount: number | null;
  items: unknown[];
  payment_method: 'stripe' | 'external_link';
  external_payment_type?: string | null;
  external_payment_label?: string | null;
  external_payment_link?: string | null;
  consent_terms_accepted?: boolean | null;
  consent_terms_doc_version?: number | null;
  consent_marketing_accepted?: boolean | null;
}

interface ExistingActiveCheckout {
  id: string;
  payment_method: 'stripe' | 'external_link';
  stripe_payment_intent_id: string | null;
}

export interface UpsertActiveCheckoutResult {
  id: string;
  reused: boolean;
  previousPaymentMethod: 'stripe' | 'external_link' | null;
  previousStripePaymentIntentId: string | null;
}

async function logCheckoutEvent(
  supabase: SupabaseClient,
  tenantId: string,
  referenceId: string,
  eventType: 'checkout_started' | 'checkout_reused',
) {
  const { error } = await supabase.from('payment_funnel_logs').insert({
    tenant_id: tenantId,
    module: 'shop',
    reference_id: referenceId,
    event_type: eventType,
  });
  if (error) {
    console.warn('[activeCheckoutSession] funnel log failed:', eventType, error);
  }
}

/**
 * Persist the current purchase intent.
 *
 * Authenticated customers have at most one open checkout per tenant. A new
 * checkout submission refreshes that row instead of creating a second payment
 * attempt. Guests still get a new row because email alone is not a safe
 * identity key; they resume through their signed checkout-session token.
 */
export async function upsertActiveCheckoutSession({
  supabase,
  tenantId,
  customerId,
  payload,
}: {
  supabase: SupabaseClient;
  tenantId: string;
  customerId: string | null;
  payload: ActiveCheckoutPayload;
}): Promise<UpsertActiveCheckoutResult> {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = checkoutExpiryFromNow(now);

  let existing: ExistingActiveCheckout | null = null;

  if (customerId) {
    // Lazy expiry keeps the state machine correct even when no cron extension
    // is installed. Expired rows remain available for analytics/audit.
    const { error: expiryError } = await supabase
      .from('checkout_sessions')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'open')
      .lte('expires_at', nowIso);
    if (expiryError) {
      console.warn('[activeCheckoutSession] lazy expiry failed:', expiryError);
    }

    const { data, error } = await supabase
      .from('checkout_sessions')
      .select('id, payment_method, stripe_payment_intent_id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'open')
      .gt('expires_at', nowIso)
      .order('last_activity_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    existing = data as ExistingActiveCheckout | null;
  }

  const writePayload = {
    ...payload,
    tenant_id: tenantId,
    customer_id: customerId,
    status: 'open' as const,
    updated_at: nowIso,
    last_activity_at: nowIso,
    expires_at: expiresAt,
  };

  if (existing) {
    const { error } = await supabase
      .from('checkout_sessions')
      .update(writePayload)
      .eq('id', existing.id)
      .eq('tenant_id', tenantId);
    if (error) throw error;

    await logCheckoutEvent(supabase, tenantId, existing.id, 'checkout_reused');
    return {
      id: existing.id,
      reused: true,
      previousPaymentMethod: existing.payment_method,
      previousStripePaymentIntentId: existing.stripe_payment_intent_id,
    };
  }

  const { data: created, error: insertError } = await supabase
    .from('checkout_sessions')
    .insert(writePayload)
    .select('id')
    .single();

  // Two tabs may race against the partial unique index. Re-read the winner and
  // update it rather than surfacing a false checkout failure to the customer.
  if ((insertError as { code?: string } | null)?.code === '23505' && customerId) {
    const { data: winner, error: winnerError } = await supabase
      .from('checkout_sessions')
      .select('id, payment_method, stripe_payment_intent_id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'open')
      .gt('expires_at', nowIso)
      .order('last_activity_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (winnerError || !winner) throw winnerError ?? insertError;

    const typedWinner = winner as ExistingActiveCheckout;
    const { error: updateError } = await supabase
      .from('checkout_sessions')
      .update(writePayload)
      .eq('id', typedWinner.id)
      .eq('tenant_id', tenantId);
    if (updateError) throw updateError;

    await logCheckoutEvent(supabase, tenantId, typedWinner.id, 'checkout_reused');
    return {
      id: typedWinner.id,
      reused: true,
      previousPaymentMethod: typedWinner.payment_method,
      previousStripePaymentIntentId: typedWinner.stripe_payment_intent_id,
    };
  }

  if (insertError || !created) throw insertError ?? new Error('checkout_session_insert_failed');

  await logCheckoutEvent(supabase, tenantId, created.id, 'checkout_started');
  return {
    id: created.id,
    reused: false,
    previousPaymentMethod: null,
    previousStripePaymentIntentId: null,
  };
}
