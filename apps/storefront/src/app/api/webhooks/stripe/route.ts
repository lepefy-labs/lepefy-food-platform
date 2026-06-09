import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

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
    const { error } = await supabase
      .from('orders')
      .update({ payment_status: 'paid', status: 'preparing' })
      .eq('stripe_payment_intent_id', intent.id);
    if (error) console.error('Failed to update order on payment_intent.succeeded:', error);
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
