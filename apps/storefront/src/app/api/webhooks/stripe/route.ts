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
    productId: string;
    name:      string;
    price:     number;
    quantity:  number;
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
      // PaymentIntent not from this platform — ignore silently
      console.info('[webhook] payment_intent.succeeded — no session_id/tenant_id in metadata, skipping');
      return NextResponse.json({ received: true });
    }

    // Idempotency guard: check if order was already created for this payment intent
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
      // Return 200 so Stripe doesn't retry — session may have been cleaned up already
      return NextResponse.json({ received: true });
    }

    const subtotal = session.items.reduce(
      (sum: number, i: { price: number; quantity: number }) => sum + i.price * i.quantity, 0,
    );
    const total = subtotal + session.shipping_total;

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
      // Return 500 so Stripe retries — this is a real failure we want to recover
      return NextResponse.json({ error: 'Order creation failed.' }, { status: 500 });
    }

    console.info('[webhook] order created — id:', order.id, '— tenant:', tenant_id, '— payment_intent:', intent.id);

    // Create order_items
    const orderItemsPayload = session.items.map((i) => ({
      order_id:   order.id,
      product_id: i.productId,
      name:       i.name,
      price:      i.price,
      quantity:   i.quantity,
      subtotal:   i.price * i.quantity,
    }));

    const { error: itemsError } = await (supabase as unknown as {
      from(table: 'order_items'): {
        insert(data: unknown[]): Promise<{ error: unknown }>;
      };
    }).from('order_items').insert(orderItemsPayload);

    if (itemsError) {
      console.error('[webhook] order_items insert error:', itemsError, '— order_id:', order.id);
      // Order exists; items failure is bad but don't block Stripe retry
    } else {
      console.info('[webhook] order_items inserted — count:', orderItemsPayload.length, '— order_id:', order.id);
    }

    // Delete checkout session — payment confirmed, session no longer needed
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
    console.info('[webhook] payment_intent.payment_failed — id:', intent.id, '— last_payment_error:', (intent as Stripe.PaymentIntent & { last_payment_error?: { message?: string } }).last_payment_error?.message);
    // No order to update in new architecture — session stays until payment succeeds or expires
  }

  return NextResponse.json({ received: true });
}
