import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { isValidCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import { checkoutExpiryFromNow } from '@/lib/checkout/activeCheckoutSession';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import type { ShippingAddress } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const stripe = getStripeClient('shop');

interface CartItemPayload {
  productId: string | null;
  name: string;
  price: number;
  quantity: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
}

interface CheckoutSessionRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  email: string;
  shipping_address: ShippingAddress | null;
  shipping_total: number;
  ambassador_discount_amount: number | null;
  items: CartItemPayload[];
  status: 'open' | 'completed' | 'cancelled' | 'expired';
  expires_at: string;
  payment_method: 'stripe' | 'external_link';
  stripe_payment_intent_id: string | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body: { accessToken?: string } = await req.json().catch(() => ({}));
    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(tenantSlug);
    const supabase = createServiceClient();
    const sessionCustomer = await getSessionCustomer(tenant.id);
    const now = new Date();
    const nowIso = now.toISOString();

    const { data, error } = await supabase
      .from('checkout_sessions')
      .select('*')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .eq('status', 'open')
      .gt('expires_at', nowIso)
      .maybeSingle();

    if (error) {
      console.error('[checkout-sessions][create-intent] lookup error:', error);
      return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Session de paiement introuvable ou expirée.' }, { status: 404 });

    const session = data as CheckoutSessionRow;
    if (session.customer_id) {
      if (!sessionCustomer || sessionCustomer.id !== session.customer_id) {
        return NextResponse.json({ error: 'Accès non autorisé à cette session.' }, { status: 403 });
      }
    } else {
      const accessToken = body.accessToken ?? null;
      if (!accessToken || !isValidCheckoutSessionAccessToken(session.id, session.email, accessToken)) {
        return NextResponse.json({ error: 'Accès non autorisé à cette session.' }, { status: 403 });
      }
    }

    if (session.payment_method !== 'stripe') {
      return NextResponse.json({ error: 'Cette session n\'est pas configurée pour un paiement par carte.' }, { status: 400 });
    }

    const subtotal = session.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const total = parseFloat((subtotal + (session.shipping_total ?? 0) - (session.ambassador_discount_amount ?? 0)).toFixed(2));
    const amount = Math.round(total * 100);

    if (session.stripe_payment_intent_id) {
      try {
        const existing = await stripe.paymentIntents.retrieve(session.stripe_payment_intent_id);
        if (existing.status !== 'canceled' && existing.status !== 'succeeded') {
          const current = existing.amount === amount
            ? existing
            : await stripe.paymentIntents.update(existing.id, {
                amount,
                metadata: { session_id: session.id, tenant_id: tenant.id },
              });
          await supabase.from('checkout_sessions').update({
            last_activity_at: nowIso,
            updated_at: nowIso,
            expires_at: checkoutExpiryFromNow(now),
          }).eq('id', session.id).eq('tenant_id', tenant.id);
          return NextResponse.json({ clientSecret: current.client_secret });
        }
      } catch (retrieveErr) {
        console.warn('[checkout-sessions][create-intent] existing intent unavailable; replacing:', retrieveErr);
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: tenant.currency ?? 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: { session_id: session.id, tenant_id: tenant.id },
    });

    const { error: updateError } = await supabase
      .from('checkout_sessions')
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        last_activity_at: nowIso,
        updated_at: nowIso,
        expires_at: checkoutExpiryFromNow(now),
      })
      .eq('id', session.id)
      .eq('tenant_id', tenant.id);

    if (updateError) {
      console.error('[checkout-sessions][create-intent] failed to persist intent id:', updateError,
        '— session:', session.id, '— intent:', paymentIntent.id);
    }

    await supabase.from('payment_funnel_logs').insert({
      tenant_id: tenant.id,
      module: 'shop',
      reference_id: session.id,
      event_type: 'intent_created',
      detail: { source: 'checkout_resume' },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('[checkout-sessions][create-intent] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
