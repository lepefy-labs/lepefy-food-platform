import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

interface CartItemPayload {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

interface ShippingAddress {
  full_name: string;
  line1: string;
  city: string;
  postal_code: string;
  country: string;
}

interface CheckoutBody {
  items: CartItemPayload[];
  shippingAddress: ShippingAddress | null;
  fulfillmentType: 'delivery' | 'pickup';
  email: string;
  phone?: string | null;
  fullName?: string | null;
  shippingTotal: number;
  shippingDetails?: Record<string, unknown> | null;
}

export async function POST(req: NextRequest) {
  try {
    const body: CheckoutBody = await req.json();
    const {
      items,
      shippingAddress,
      fulfillmentType,
      email,
      phone,
      fullName,
      shippingTotal,
      shippingDetails,
    } = body;

    if (!items?.length || !email) {
      return NextResponse.json({ error: 'Données manquantes.' }, { status: 400 });
    }

    const tenant = await getTenant();
    const supabase = createServiceClient();

    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const total = subtotal + (shippingTotal ?? 0);

    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        tenant_id: tenant.id,
        customer_id: null,
        email,
        full_name: fullName ?? null,
        fulfillment_type: fulfillmentType,
        shipping_address: shippingAddress ?? null,
        shipping_details: shippingDetails ?? null,
        subtotal,
        shipping_cost: shippingTotal ?? 0,
        total,
        payment_method: 'stripe',
        payment_status: 'pending',
        stripe_payment_intent_id: null,
        status: 'new',
        tracking_code: null,
        tracking_carrier: null,
        shipped_at: null,
        notes: phone ? `Téléphone: ${phone}` : null,
      })
      .select('id')
      .single();

    if (orderError || !order) {
      console.error('Order insert error:', orderError);
      return NextResponse.json(
        { error: 'Erreur lors de la création de la commande.' },
        { status: 500 },
      );
    }

    // Insert order items (table not yet in generated types; use explicit cast)
    const orderItemsPayload = items.map((i) => ({
      order_id: order.id,
      tenant_id: tenant.id,
      product_id: i.productId,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      subtotal: i.price * i.quantity,
    }));

    const { error: itemsError } = await (supabase as unknown as {
      from: (t: string) => { insert: (rows: unknown[]) => Promise<{ error: unknown }> };
    }).from('order_items').insert(orderItemsPayload);

    if (itemsError) {
      console.error('Order items insert error:', itemsError);
    }

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: tenant.currency.toLowerCase(),
      metadata: { orderId: order.id, tenantId: tenant.id },
      automatic_payment_methods: { enabled: true },
    });

    // Attach PaymentIntent to order
    await supabase
      .from('orders')
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq('id', order.id);

    return NextResponse.json({ orderId: order.id, clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Checkout error:', err);
    return NextResponse.json({ error: 'Erreur interne du serveur.' }, { status: 500 });
  }
}
