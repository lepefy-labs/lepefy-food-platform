import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

interface CheckoutSessionRow {
  id:               string;
  tenant_id:        string;
  email:            string;
  full_name:        string | null;
  phone:            string | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: Record<string, unknown> | null;
  shipping_details: Record<string, unknown> | null;
  shipping_total:   number;
  items: Array<{
    productId:    string;
    name:         string;
    price:        number;
    quantity:     number;
    storage_type: 'dry' | 'fresh' | 'frozen' | null;
  }>;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig  = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const { session_id, tenant_id } = intent.metadata ?? {};

    if (!session_id || !tenant_id) {
      console.info('[webhook] payment_intent.succeeded — no session_id/tenant_id in metadata, skipping');
      return NextResponse.json({ received: true });
    }

    // Idempotency guard
    const { data: existing } = await supabase
      .from('orders')
      .select('id')
      .eq('stripe_payment_intent_id', intent.id)
      .maybeSingle();

    if (existing) {
      console.info('[webhook] order already exists for payment_intent:', intent.id, '— skipping duplicate webhook');
      return NextResponse.json({ received: true });
    }

    // Fetch checkout session
    const { data: session, error: sessionError } = await supabase
      .from('checkout_sessions')
      .select('*')
      .eq('id', session_id)
      .eq('tenant_id', tenant_id)
      .single() as { data: CheckoutSessionRow | null; error: unknown };

    if (sessionError || !session) {
      console.error('[webhook] checkout_session not found — session_id:', session_id, '— error:', sessionError);
      return NextResponse.json({ received: true });
    }

    const subtotal = session.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const total    = subtotal + session.shipping_total;

    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        tenant_id:                tenant_id,
        customer_id:              null,
        email:                    session.email,
        full_name:                session.full_name,
        fulfillment_type:         session.fulfillment_type,
        shipping_address:         session.shipping_address,
        shipping_details:         session.shipping_details,
        subtotal,
        shipping_cost:            session.shipping_total,
        total,
        payment_method:           'stripe',
        payment_status:           'paid',
        stripe_payment_intent_id: intent.id,
        status:                   'preparing',
        notes:                    session.phone ? `Téléphone: ${session.phone}` : null,
      })
      .select('id')
      .single();

    if (orderError || !order) {
      console.error('[webhook] orders insert error:', orderError);
      return NextResponse.json({ error: 'Order creation failed.' }, { status: 500 });
    }

    console.info('[webhook] order created — id:', order.id, '— tenant:', tenant_id, '— payment_intent:', intent.id);

    // Insert order_items with explicit fields — no spread to avoid null overwrites
    const orderItemsPayload = session.items.map((i) => ({
      order_id:     order.id,
      tenant_id:    tenant_id,
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
      console.error('[webhook] order_items insert error:', itemsError, '— order_id:', order.id, '— tenant_id:', tenant_id);
    } else {
      console.info('[webhook] order_items inserted successfully — count:', orderItemsPayload.length, '— order_id:', order.id);
    }

    // Delete checkout session
    const { error: deleteError } = await supabase
      .from('checkout_sessions')
      .delete()
      .eq('id', session_id);

    if (deleteError) {
      console.error('[webhook] checkout_session delete error (non-critical):', deleteError);
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    console.info('[webhook] payment_intent.payment_failed — id:', intent.id);
  }

  return NextResponse.json({ received: true });
}
