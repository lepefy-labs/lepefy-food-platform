import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { isValidCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import type { ShippingAddress } from '@lepefy/types';

// Route séparée volontaire (cf. 02_checkout_en_attente_editor.md, Task 2) —
// PATCH /api/checkout-sessions/[id] ne crée jamais de PaymentIntent quand
// aucun n'existe encore (flux différé), par design : sa création reste du
// ressort du frontend "au moment voulu". Pour une session reprise depuis
// CheckoutSessionEditor (ex. switch external_link → stripe, ou reprise
// d'une session stripe jamais arrivée à l'étape paiement), ce moment est ici
// — juste avant de monter StripePaymentStep. Le fichier [id]/route.ts n'est
// pas modifié pour ça (hors scope, cf. règle "file da NON toccare").
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const stripe = getStripeClient('shop');

interface CartItemPayload {
  productId:    string | null;
  name:         string;
  price:        number;
  quantity:     number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
}

interface CheckoutSessionRow {
  id:                         string;
  tenant_id:                  string;
  customer_id:                string | null;
  email:                      string;
  shipping_address:           ShippingAddress | null;
  shipping_total:             number;
  ambassador_discount_amount: number | null;
  items:                      CartItemPayload[];
  status:                     'open' | 'cancelled';
  payment_method:             'stripe' | 'external_link';
  stripe_payment_intent_id:   string | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body: { accessToken?: string } = await req.json().catch(() => ({}));

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant      = await getTenant(tenantSlug);
    const supabase    = createServiceClient();

    const sessionCustomer = await getSessionCustomer(tenant.id);

    // Même pattern d'autorisation que [id]/route.ts (dupliqué volontairement
    // — un route.ts Next.js ne peut exporter que les handlers HTTP/config
    // reconnus, aucun helper partagé importable depuis ce fichier).
    const { data, error } = await supabase
      .from('checkout_sessions')
      .select('*')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .eq('status', 'open')
      .maybeSingle();

    if (error) {
      console.error('[checkout-sessions][create-intent] lookup error:', error);
      return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Session de paiement introuvable.' }, { status: 404 });
    }

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
      return NextResponse.json(
        { error: 'Cette session n\'est pas configurée pour un paiement par carte.' },
        { status: 400 },
      );
    }

    // Intent déjà existant (créé à l'origine par /api/checkout, ou par un
    // appel précédent à cette route) : on le réutilise tel quel, jamais de
    // doublon — même client secret, cohérent avec un rechargement de page.
    if (session.stripe_payment_intent_id) {
      try {
        const existing = await stripe.paymentIntents.retrieve(session.stripe_payment_intent_id);
        if (existing.status !== 'canceled') {
          return NextResponse.json({ clientSecret: existing.client_secret });
        }
      } catch (retrieveErr) {
        console.warn('[checkout-sessions][create-intent] failed to retrieve existing intent, creating a new one:',
          retrieveErr, '— id:', session.stripe_payment_intent_id);
      }
    }

    const subtotal = session.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const total = parseFloat(
      (subtotal + (session.shipping_total ?? 0) - (session.ambassador_discount_amount ?? 0)).toFixed(2),
    );

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(total * 100),
      currency: tenant.currency ?? 'eur',
      // Voir api/checkout/route.ts : liste explicite pour exclure Link.
      payment_method_types: ['card'],
      metadata: {
        session_id: session.id,
        tenant_id:  tenant.id,
      },
    });

    const { error: updateError } = await supabase
      .from('checkout_sessions')
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq('id', session.id)
      .eq('tenant_id', tenant.id);

    if (updateError) {
      console.error('[checkout-sessions][create-intent] failed to persist intent id:', updateError,
        '— session:', session.id, '— intent:', paymentIntent.id);
    }

    console.info('[checkout-sessions][create-intent] PaymentIntent created — id:', paymentIntent.id,
      '— session:', session.id, '— amount:', paymentIntent.amount);

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('[checkout-sessions][create-intent] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
