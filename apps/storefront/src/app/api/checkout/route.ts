import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

interface CartItemPayload {
  productId:    string;
  name:         string;
  price:        number;
  quantity:     number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
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
  paymentMethod?:  'stripe' | 'in_store';
}

export async function POST(req: NextRequest) {
  try {
    const body: CheckoutBody = await req.json();
    const {
      items, shippingAddress, fulfillmentType, email,
      phone, fullName, shippingTotal, shippingDetails,
      paymentMethod = 'stripe',
    } = body;

    if (!items?.length || !email) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant     = await getTenant(tenantSlug);
    const supabase   = createServiceClient();

    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const total    = subtotal + (shippingTotal ?? 0);

    // ── In-store payment: create order directly, no Stripe ──────────────────
    if (paymentMethod === 'in_store') {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          tenant_id:        tenant.id,
          customer_id:      null,
          email,
          full_name:        fullName ?? null,
          fulfillment_type: fulfillmentType,
          shipping_address: shippingAddress ?? null,
          shipping_details: shippingDetails ?? null,
          subtotal,
          shipping_cost:    shippingTotal ?? 0,
          total,
          payment_method:   'in_store',
          payment_status:   'pending',
          status:           'preparing',
          notes:            phone ? `Téléphone: ${phone}` : null,
        })
        .select('id')
        .single();

      if (orderError || !order) {
        console.error('[checkout] in_store order insert error:', orderError);
        return NextResponse.json(
          { error: 'Erreur lors de la création de la commande.' },
          { status: 500 },
        );
      }

      // Insert order_items
      const orderItemsPayload = items.map((i) => ({
        order_id:     order.id,
        tenant_id:    tenant.id,
        product_id:   i.productId ?? null,
        name:         i.name,
        price:        i.price,
        quantity:     i.quantity,
        subtotal:     i.price * i.quantity,
        storage_type: i.storage_type ?? 'dry',
      }));

      const { error: itemsError } = await (supabase as unknown as {
        from(table: 'order_items'): {
          insert(data: unknown[]): Promise<{ error: unknown }>;
        };
      }).from('order_items').insert(orderItemsPayload);

      if (itemsError) {
        console.error('[checkout] in_store order_items insert error:', itemsError, '— order_id:', order.id);
      } else {
        console.info('[checkout] in_store order created — id:', order.id, '— items:', orderItemsPayload.length);
      }

      return NextResponse.json({ orderId: order.id });
    }

    // ── Stripe payment: save checkout_session, create PaymentIntent ──────────
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
        items,
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

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(total * 100),
      currency: tenant.currency ?? 'eur',
      metadata: {
        session_id: session.id,
        tenant_id:  tenant.id,
      },
    });

    console.info('[checkout] PaymentIntent created — id:', paymentIntent.id, '— amount:', paymentIntent.amount);

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('[checkout] unhandled error:', err);
    return NextResponse.json(
      { error: 'Erreur serveur. Veuillez réessayer.' },
      { status: 500 },
    );
  }
}
