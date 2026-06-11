import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ─── Token ────────────────────────────────────────────────────────────────────

function generateTrackingToken(orderId: string, email: string): string {
  return crypto
    .createHmac('sha256', process.env.TRACKING_SECRET!)
    .update(orderId + email)
    .digest('hex');
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig  = req.headers.get('stripe-signature');

  if (!sig) {
    console.error('[webhook] Missing stripe-signature header');
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  console.info('[webhook] Received event:', event.type, '— id:', event.id);

  // ── payment_intent.succeeded — create order from checkout_session ──────────
  if (event.type === 'payment_intent.succeeded') {
    const intent    = event.data.object as Stripe.PaymentIntent;
    const sessionId = intent.metadata?.session_id;
    const tenantId  = intent.metadata?.tenant_id;

    console.info('[webhook] payment_intent.succeeded — intent:', intent.id,
      '— session_id:', sessionId, '— tenant_id:', tenantId);

    if (!sessionId) {
      console.error('[webhook] No session_id in PaymentIntent metadata — intent:', intent.id);
      // Return 200 so Stripe does not retry; this is a data integrity issue, not a transient error
      return NextResponse.json({ received: true });
    }

    const supabase = createServiceClient();

    // ── Idempotency: check if order already exists ──────────────────────────
    const { data: existing } = await supabase
      .from('orders')
      .select('id')
      .eq('stripe_payment_intent_id', intent.id)
      .maybeSingle();

    if (existing) {
      console.info('[webhook] Order already exists for intent:', intent.id, '— skipping');
      return NextResponse.json({ received: true });
    }

    // ── Fetch checkout_session ───────────────────────────────────────────────
    const { data: session, error: sessionError } = await supabase
      .from('checkout_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle() as {
        data: {
          id:               string;
          tenant_id:        string;
          email:            string;
          full_name:        string | null;
          phone:            string | null;
          fulfillment_type: 'delivery' | 'pickup';
          shipping_address: Record<string, unknown> | null;
          shipping_details: Record<string, unknown> | null;
          shipping_total:   number;
          items: {
            productId:    string | null;
            name:         string;
            price:        number;
            quantity:     number;
            storage_type: 'dry' | 'fresh' | 'frozen' | null;
          }[];
        } | null;
        error: unknown;
      };

    if (sessionError) {
      console.error('[webhook] Error fetching checkout_session:', sessionError);
      return NextResponse.json({ received: true });
    }

    if (!session) {
      console.error('[webhook] checkout_session not found — id:', sessionId);
      return NextResponse.json({ received: true });
    }

    console.info('[webhook] checkout_session found — id:', session.id,
      '— email:', session.email, '— items:', session.items?.length ?? 0);

    // ── Resolve tenant ───────────────────────────────────────────────────────
    const resolvedTenantId = session.tenant_id ?? tenantId;
    if (!resolvedTenantId) {
      console.error('[webhook] Cannot resolve tenant_id — session:', session.id);
      return NextResponse.json({ received: true });
    }

    // ── Compute totals ───────────────────────────────────────────────────────
    const items    = session.items ?? [];
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const total    = subtotal + (session.shipping_total ?? 0);

    console.info('[webhook] Creating order — tenant:', resolvedTenantId,
      '— subtotal:', subtotal, '— total:', total);

    // ── Create order ─────────────────────────────────────────────────────────
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        tenant_id:                 resolvedTenantId,
        customer_id:               null,
        email:                     session.email,
        full_name:                 session.full_name ?? null,
        fulfillment_type:          session.fulfillment_type,
        shipping_address:          session.shipping_address ?? null,
        shipping_details:          session.shipping_details ?? null,
        subtotal,
        shipping_cost:             session.shipping_total ?? 0,
        total,
        payment_method:            'stripe',
        payment_status:            'paid',
        stripe_payment_intent_id:  intent.id,
        status:                    'preparing',
        notes:                     session.phone ? `Téléphone: ${session.phone}` : null,
      })
      .select('id')
      .single();

    if (orderError || !order) {
      console.error('[webhook] Failed to create order:', orderError);
      return NextResponse.json({ received: true });
    }

    console.info('[webhook] Order created — id:', order.id);

    // ── Insert order_items ───────────────────────────────────────────────────
    const orderItemsPayload = items.map((i) => ({
      order_id:     order.id,
      tenant_id:    resolvedTenantId,
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
      console.error('[webhook] Failed to insert order_items:', itemsError,
        '— order_id:', order.id);
    } else {
      console.info('[webhook] order_items inserted —', orderItemsPayload.length, 'rows');
    }

    // ── Delete checkout_session ──────────────────────────────────────────────
    const { error: deleteError } = await supabase
      .from('checkout_sessions')
      .delete()
      .eq('id', sessionId);

    if (deleteError) {
      console.warn('[webhook] Failed to delete checkout_session:', deleteError,
        '— id:', sessionId);
    } else {
      console.info('[webhook] checkout_session deleted — id:', sessionId);
    }

    // ── Notify n8n ───────────────────────────────────────────────────────────
    if (process.env.N8N_WEBHOOK_URL && process.env.TRACKING_SECRET) {
      try {
        const trackingToken     = generateTrackingToken(order.id, session.email);
        const storefrontUrl     = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
        const orderTrackingLink = `${storefrontUrl}/orders/${order.id}?token=${trackingToken}`;

        const n8nPayload = {
          orderId:          order.id,
          email:            session.email,
          fullName:         session.full_name ?? '',
          total,
          shippingTotal:    session.shipping_total ?? 0,
          shippingAddress:  session.shipping_address ?? null,
          orderTrackingLink,
        };

        console.info('[webhook] Notifying n8n — url:',
          `${process.env.N8N_WEBHOOK_URL}/webhook/order-confirmed`);

        const n8nRes = await fetch(
          `${process.env.N8N_WEBHOOK_URL}/webhook/order-confirmed`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(n8nPayload),
          },
        );

        console.info('[webhook] n8n response status:', n8nRes.status);
      } catch (n8nErr) {
        console.error('[webhook] n8n notification failed:', n8nErr);
      }
    } else {
      console.warn('[webhook] N8N_WEBHOOK_URL or TRACKING_SECRET not set — skipping n8n');
    }
  }

  // ── payment_intent.payment_failed ─────────────────────────────────────────
  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    console.info('[webhook] payment_intent.payment_failed — intent:', intent.id);

    // Try to mark order failed if it somehow exists (e.g. partial retry)
    const { error } = await createServiceClient()
      .from('orders')
      .update({ payment_status: 'failed' })
      .eq('stripe_payment_intent_id', intent.id);

    if (error) {
      console.warn('[webhook] Could not update failed order (may not exist yet):', error);
    }
  }

  return NextResponse.json({ received: true });
}
