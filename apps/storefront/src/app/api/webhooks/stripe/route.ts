import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function generateTrackingToken(orderId: string, email: string): string {
  return crypto
    .createHmac('sha256', process.env.TRACKING_SECRET!)
    .update(orderId + email)
    .digest('hex');
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
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;

    const { error: updateError } = await supabase
      .from('orders')
      .update({ payment_status: 'paid', status: 'preparing' })
      .eq('stripe_payment_intent_id', intent.id);

    if (updateError) {
      console.error('Failed to update order on payment_intent.succeeded:', updateError);
    } else {
      // Fetch order to build n8n payload
      const { data: order } = await supabase
        .from('orders')
        .select('id, email, full_name, total, shipping_cost, shipping_address')
        .eq('stripe_payment_intent_id', intent.id)
        .maybeSingle() as {
          data: {
            id:               string;
            email:            string;
            full_name:        string | null;
            total:            number;
            shipping_cost:    number;
            shipping_address: Record<string, unknown> | null;
          } | null;
        };

      if (order && process.env.N8N_WEBHOOK_URL && process.env.TRACKING_SECRET) {
        try {
          const trackingToken    = generateTrackingToken(order.id, order.email);
          const storefrontUrl    = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
          const orderTrackingLink = `${storefrontUrl}/orders/${order.id}?token=${trackingToken}`;

          await fetch(`${process.env.N8N_WEBHOOK_URL}/webhook/order-confirmed`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId:         order.id,
              email:           order.email,
              fullName:        order.full_name ?? '',
              total:           order.total,
              shippingTotal:   order.shipping_cost,
              shippingAddress: order.shipping_address ?? null,
              orderTrackingLink,
            }),
          });

          console.info('[webhook] n8n notified — order:', order.id);
        } catch (n8nErr) {
          // Non-fatal: log and continue
          console.error('[webhook] n8n notification failed:', n8nErr);
        }
      }
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const { error } = await supabase
      .from('orders')
      .update({ payment_status: 'failed' })
      .eq('stripe_payment_intent_id', intent.id);
    if (error) console.error('Failed to update order on payment_intent.payment_failed:', error);
  }

  return NextResponse.json({ received: true });
}
