import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

interface CartItemPayload {
  productId: string;
  name:      string;
  price:     number;
  quantity:  number;
}

interface ShippingAddress {
  full_name:   string;
  line1:       string;
  city:        string;
  postal_code: string;
  country:     string;
}

interface CheckoutBody {
  items:           CartItemPayload[];
  shippingAddress: ShippingAddress | null;
  fulfillmentType: 'delivery' | 'pickup';
  email:           string;
  phone?:          string | null;
  fullName?:       string | null;
  shippingTotal:   number;
  shippingDetails: Record<string, unknown> | null;
}

export async function POST(req: NextRequest) {
  try {
    const body: CheckoutBody = await req.json();
    const { items, shippingAddress, fulfillmentType, email, phone, fullName, shippingTotal, shippingDetails } = body;

    if (!items?.length || !email) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(tenantSlug);
    const supabase = createServiceClient();

    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const total    = subtotal + (shippingTotal ?? 0);

    // Save to checkout_sessions — order is created by the webhook on payment confirmation
    const { data: session, error: sessionError } = await supabase
      .from('checkout_sessions')
      .insert({
        tenant_id:        tenant.id,
        email,
        full_name:        fullName ?? null,
        phone:            phone ?? null,
        fulfillment_type: fulfillmentType,
        shipping_address: shippingAddress ?? null,
        shipping_details: shippingDetails ?? null,
        shipping_total:   shippingTotal ?? 0,
        items:            items,
      })
      .select('id')
      .single();

    if (sessionError || !session) {
      console.error('[checkout] checkout_sessions insert error:', sessionError);
      return NextResponse.json(
        { error: 'Erreur lors de la création de la session de paiement.' },
        { status: 500 },
      );
    }

    console.info('[checkout] checkout_session created — id:', session.id, '— tenant:', tenant.id);

    // PaymentIntent: metadata only carries session_id + tenant_id (no items — avoids 500-char Stripe limit)
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(total * 100),
      currency: tenant.currency ?? 'eur',
      metadata: {
        session_id: session.id,
        tenant_id:  tenant.id,
      },
    });

    console.info('[checkout] PaymentIntent created — id:', paymentIntent.id, '— amount:', paymentIntent.amount, '— session_id:', session.id);

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('[checkout] unhandled error:', err);
    return NextResponse.json(
      { error: 'Erreur serveur. Veuillez réessayer.' },
      { status: 500 },
    );
  }
}
