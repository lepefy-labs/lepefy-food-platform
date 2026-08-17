import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { generateTrackingToken } from '@/lib/tracking/generateTrackingToken';
import { formatShippingAddress } from '@/lib/orders/formatShippingAddress';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { createEventReservationFromRequest } from '@/lib/events/createEventReservationFromRequest';
import type { ShippingAddress, EventCheckoutItemInput } from '@lepefy/types';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

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

  // ─── ABBONAMENTO SAAS ──────────────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Gestisce solo i pagamenti SaaS (non confondere con gli ordini storefront)
    if (session.metadata?.type !== 'saas_subscription') {
      return NextResponse.json({ received: true });
    }

    const tenantSlug = session.metadata?.tenant_slug;
    if (!tenantSlug) {
      console.error('[webhook/billing] checkout.session.completed — tenant_slug mancante nei metadata');
      return NextResponse.json({ received: true });
    }

    // Calcola il nuovo periodo: +30 giorni dalla data di pagamento
    const paidAt = new Date(session.created * 1000);
    const paidUntil = new Date(paidAt);
    paidUntil.setDate(paidUntil.getDate() + 30);

    const supabase = createServiceClient();

    const { error } = await supabase
      .from('tenants')
      .update({
        subscription_status:     'active',
        subscription_paid_until: paidUntil.toISOString(),
        updated_at:              new Date().toISOString(),
      })
      .eq('slug', tenantSlug);

    if (error) {
      console.error('[webhook/billing] errore aggiornamento tenant:', error);
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }

    console.info(`[webhook/billing] abbonamento rinnovato per tenant: ${tenantSlug} fino al ${paidUntil.toISOString()}`);

    return NextResponse.json({ received: true });
  }

  // ── payment_intent.succeeded — create order from checkout_session ──────────
  if (event.type === 'payment_intent.succeeded') {
    const intent    = event.data.object as Stripe.PaymentIntent;

    // Paiement carte à montant libre depuis /card (scan QR) — domaine
    // indépendant de orders/checkout_sessions, routé avant la logique
    // commande existante, jamais mélangé avec elle.
    if (intent.metadata?.type === 'card_quick_payment') {
      return handleCardQuickPaymentSucceeded(intent);
    }

    // Réservation billetterie événementiel payée par carte (Stripe Elements
    // sur /evenements/[id]) — domaine indépendant de orders/checkout_sessions,
    // routé avant la logique commande existante, jamais mélangé avec elle.
    if (intent.metadata?.type === 'event_reservation') {
      return handleEventReservationPaymentSucceeded(intent);
    }

    const sessionId = intent.metadata?.session_id;
    const tenantId  = intent.metadata?.tenant_id;

    console.info('[webhook] payment_intent.succeeded — intent:', intent.id,
      '— session_id:', sessionId, '— tenant_id:', tenantId);

    if (!sessionId) {
      console.error('[webhook] No session_id in PaymentIntent metadata — intent:', intent.id);
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
    const { data: checkoutSession, error: sessionError } = await supabase
      .from('checkout_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle() as {
        data: {
          id:               string;
          tenant_id:        string;
          customer_id:      string | null;
          email:            string;
          full_name:        string | null;
          phone:            string | null;
          fulfillment_type: 'delivery' | 'pickup';
          shipping_address: Record<string, unknown> | null;
          shipping_details: Record<string, unknown> | null;
          shipping_total:   number;
          ambassador_discount_amount: number | null;
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

    if (!checkoutSession) {
      console.error('[webhook] checkout_session not found — id:', sessionId);
      return NextResponse.json({ received: true });
    }

    console.info('[webhook] checkout_session found — id:', checkoutSession.id,
      '— email:', checkoutSession.email, '— items:', checkoutSession.items?.length ?? 0);

    // ── Resolve tenant ───────────────────────────────────────────────────────
    const resolvedTenantId = checkoutSession.tenant_id ?? tenantId;
    if (!resolvedTenantId) {
      console.error('[webhook] Cannot resolve tenant_id — session:', checkoutSession.id);
      return NextResponse.json({ received: true });
    }

    // ── Compute totals ───────────────────────────────────────────────────────
    // ambassador_discount_amount vient de checkout_sessions, PAS recalculé
    // ici : c'est la valeur déjà figée au moment de créer le PaymentIntent
    // (POST /api/checkout) — le client a payé exactement ce montant, le
    // recalculer ici risquerait un drift si l'état (première commande,
    // config tenant) a changé entre les deux étapes.
    const items              = checkoutSession.items ?? [];
    const subtotal           = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const ambassadorDiscount = checkoutSession.ambassador_discount_amount ?? 0;
    const total              = subtotal + (checkoutSession.shipping_total ?? 0) - ambassadorDiscount;

    console.info('[webhook] Creating order — tenant:', resolvedTenantId,
      '— subtotal:', subtotal, '— total:', total);

    // ── Create order ─────────────────────────────────────────────────────────
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        tenant_id:                 resolvedTenantId,
        customer_id:               checkoutSession.customer_id ?? null,
        email:                     checkoutSession.email,
        full_name:                 checkoutSession.full_name ?? null,
        fulfillment_type:          checkoutSession.fulfillment_type,
        shipping_address:          checkoutSession.shipping_address ?? null,
        shipping_details:          checkoutSession.shipping_details ?? null,
        subtotal,
        shipping_cost:             checkoutSession.shipping_total ?? 0,
        total,
        ambassador_discount_amount: ambassadorDiscount,
        payment_method:            'stripe',
        payment_status:            'paid',
        stripe_payment_intent_id:  intent.id,
        status:                    'preparing',
        notes:                     checkoutSession.phone ? `Téléphone: ${checkoutSession.phone}` : null,
      })
      .select('id')
      .single();

    if (orderError || !order) {
      // 23505 = unique_violation su stripe_payment_intent_id: un retry
      // concorrente ha già creato l'ordine — non è un errore.
      if ((orderError as { code?: string } | null)?.code === '23505') {
        console.info('[webhook] Order already created by concurrent retry — intent:', intent.id);
        return NextResponse.json({ received: true });
      }
      console.error('[webhook] Failed to create order:', orderError);
      return NextResponse.json({ received: true });
    }

    console.info('[webhook] Order created — id:', order.id);

    // ── Décrément atomique du stock (confirmation définitive du paiement) ────
    // Le paiement Stripe est déjà capturé à ce stade — en cas d'échec on ne
    // peut plus rejeter la commande, cf. bloc "stock conflict" plus bas.
    const stockByProduct = new Map<string, number>();
    for (const i of items) {
      if (!i.productId) continue;
      stockByProduct.set(i.productId, (stockByProduct.get(i.productId) ?? 0) + i.quantity);
    }
    const stockDecrementItems = Array.from(stockByProduct.entries()).map(
      ([productId, quantity]) => ({ product_id: productId, quantity }),
    );

    const { error: stockError } = await supabase.rpc('decrement_stock_for_order', {
      items: stockDecrementItems,
    });

    if (stockError) {
      console.error('[webhook] Stock decrement failed AFTER payment capture — order:', order.id,
        '— reason:', stockError.message);
    } else {
      console.info('[webhook] Stock decremented — order:', order.id);
    }

    // ── Insert order_items ───────────────────────────────────────────────────
    // Fait dans tous les cas (succès ou conflit) : trace de ce qui a été
    // commandé, nécessaire pour le remboursement/diagnostic ci-dessous.
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

    // ── Cas conflit de stock post-paiement : remboursement + alerte admin ────
    // Le client a déjà payé (Stripe) mais on ne peut pas honorer la commande.
    // Pas de rejet possible ici — on rembourse automatiquement et on marque
    // la commande pour intervention manuelle. Aucune notification client
    // automatique dans ce prompt (texte à valider avec Dalice — hors scope).
    if (stockError) {
      let refundSucceeded = false;
      try {
        const refund = await stripe.refunds.create({ payment_intent: intent.id });
        refundSucceeded = true;
        console.info('[webhook] Refund issued — order:', order.id, '— refund id:', refund.id);
      } catch (refundErr) {
        console.error('[webhook] Refund FAILED — order:', order.id, '— needs manual refund:', refundErr);
      }

      const { error: statusUpdateError } = await supabase
        .from('orders')
        .update({
          status:         'stock_conflict',
          payment_status: refundSucceeded ? 'refunded' : 'paid',
        })
        .eq('id', order.id);

      if (statusUpdateError) {
        console.error('[webhook] Failed to mark order as stock_conflict:', statusUpdateError,
          '— order:', order.id);
      }

      if (process.env.N8N_WEBHOOK_URL) {
        try {
          const storefrontUrl  = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
          const adminOrderLink = `${storefrontUrl}/admin/orders/${order.id}`;

          const n8nConflictPayload = {
            orderId:         order.id,
            email:           checkoutSession.email,
            fullName:        checkoutSession.full_name ?? '',
            total,
            reason:          stockError.message, // "insufficient_stock:<product_id>"
            refundSucceeded,
            adminOrderLink,
          };

          console.info('[webhook] Notifying n8n (stock conflict) — url:',
            `${process.env.N8N_WEBHOOK_URL}/webhook/order-stock-conflict`);

          const n8nRes = await fetch(
            `${process.env.N8N_WEBHOOK_URL}/webhook/order-stock-conflict`,
            {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify(n8nConflictPayload),
            },
          );

          console.info('[webhook] n8n (stock conflict) response status:', n8nRes.status);
        } catch (n8nErr) {
          console.error('[webhook] n8n stock-conflict notification failed:', n8nErr);
        }
      } else {
        console.warn('[webhook] N8N_WEBHOOK_URL not set — skipping stock-conflict admin notification');
      }

      return NextResponse.json({ received: true });
    }

    // ── Notify n8n ───────────────────────────────────────────────────────────
    if (process.env.N8N_WEBHOOK_URL && process.env.TRACKING_SECRET) {
      try {
        const trackingToken     = generateTrackingToken(order.id, checkoutSession.email);
        const storefrontUrl     = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
        const orderTrackingLink = `${storefrontUrl}/orders/${order.id}?token=${trackingToken}`;

        const n8nPayload = {
          orderId:                  order.id,
          orderNumber:              `#${order.id.slice(0, 8).toUpperCase()}`,
          email:                    checkoutSession.email,
          fullName:                 checkoutSession.full_name ?? '',
          total,
          shippingTotal:            checkoutSession.shipping_total ?? 0,
          shippingAddress:          checkoutSession.shipping_address ?? null,
          shippingAddressFormatted: formatShippingAddress(
            (checkoutSession.shipping_address as ShippingAddress | null) ?? null,
          ),
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

// ─── card_quick_payment — paiement carte à montant libre depuis /card ────────
// Domaine indépendant de orders/checkout_sessions (voir api/card/quick-pay).
// Notification n8n destinée au tenant (Dalice) uniquement — pas de reçu
// automatique au client, customer_email ne sert ici qu'à informer le tenant.
async function handleCardQuickPaymentSucceeded(intent: Stripe.PaymentIntent): Promise<NextResponse> {
  const quickPaymentId = intent.metadata?.quick_payment_id;

  console.info('[webhook] card_quick_payment succeeded — intent:', intent.id, '— quick_payment_id:', quickPaymentId);

  if (!quickPaymentId) {
    console.error('[webhook] No quick_payment_id in PaymentIntent metadata — intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  const supabase = createServiceClient();

  const { data: payment, error: fetchError } = await supabase
    .from('tenant_card_payments')
    .select('id, tenant_id, amount, currency, customer_name, customer_email, status')
    .eq('id', quickPaymentId)
    .maybeSingle();

  if (fetchError || !payment) {
    console.error('[webhook] tenant_card_payments row not found — id:', quickPaymentId, '— error:', fetchError);
    return NextResponse.json({ received: true });
  }

  // Idempotence — un retry de Stripe ne doit pas renvoyer une seconde
  // notification n8n pour le même paiement.
  if (payment.status === 'paid') {
    console.info('[webhook] card_quick_payment already marked paid — skipping — id:', quickPaymentId);
    return NextResponse.json({ received: true });
  }

  const paidAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('tenant_card_payments')
    .update({ status: 'paid', paid_at: paidAt })
    .eq('id', quickPaymentId);

  if (updateError) {
    console.error('[webhook] Failed to mark card_quick_payment as paid:', updateError, '— id:', quickPaymentId);
    return NextResponse.json({ received: true });
  }

  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', payment.tenant_id)
    .maybeSingle();

  await notifyN8n('/webhook/card-quick-payment', {
    tenant_id:                payment.tenant_id,
    tenant_name:               tenantRow?.name ?? null,
    amount:                    payment.amount,
    currency:                  payment.currency,
    customer_name:             payment.customer_name,
    customer_email:            payment.customer_email,
    paid_at:                   paidAt,
    stripe_payment_intent_id:  intent.id,
  });

  return NextResponse.json({ received: true });
}

// ─── event_reservation — billetterie événementiel payée par carte (Stripe) ───
// Réutilise createEventReservationFromRequest, déjà utilisée telle quelle par
// le flux Phase 2 (external_link, confirmation manuelle) — voir
// api/admin/evenementiel/reservation-requests/[id]/confirm-payment. Toute la
// logique métier (capacité, qr_token, remboursement, notification n8n avec
// ticketUrl) vit dans cette fonction partagée ; ce handler ne fait que router
// les metadata du PaymentIntent et gérer l'idempotence côté webhook.
async function handleEventReservationPaymentSucceeded(intent: Stripe.PaymentIntent): Promise<NextResponse> {
  const eventId       = intent.metadata?.event_id;
  const tenantId       = intent.metadata?.tenant_id;
  const rawItems       = intent.metadata?.items;
  const customerName   = intent.metadata?.customer_name ?? '';
  const customerEmail  = intent.metadata?.customer_email ?? '';
  const customerPhone  = intent.metadata?.customer_phone ?? '';

  console.info('[webhook] event_reservation succeeded — intent:', intent.id,
    '— event_id:', eventId, '— tenant_id:', tenantId);

  if (!eventId || !tenantId || !rawItems) {
    console.error('[webhook] Missing event_id/tenant_id/items in PaymentIntent metadata — intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  let items: EventCheckoutItemInput[];
  try {
    items = JSON.parse(rawItems) as EventCheckoutItemInput[];
  } catch (parseErr) {
    console.error('[webhook] Failed to parse items JSON in PaymentIntent metadata — intent:', intent.id, '— error:', parseErr);
    return NextResponse.json({ received: true });
  }

  const supabase = createServiceClient();

  // ── Idempotency: check if reservation already exists ────────────────────
  const { data: existing } = await supabase
    .from('event_reservations')
    .select('id')
    .eq('stripe_payment_intent_id', intent.id)
    .maybeSingle();

  if (existing) {
    console.info('[webhook] Event reservation already exists for intent:', intent.id, '— skipping');
    return NextResponse.json({ received: true });
  }

  const result = await createEventReservationFromRequest(supabase, {
    eventId,
    tenantId,
    items,
    customerName,
    customerEmail,
    customerPhone,
    amountPaid:             intent.amount / 100,
    stripePaymentIntentId:  intent.id,
  });

  if ('reservationId' in result) {
    console.info('[webhook] Event reservation created — id:', result.reservationId, '— intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  // stock_conflict et already_exists sont déjà entièrement gérés dans
  // createEventReservationFromRequest (remboursement automatique + n8n pour
  // stock_conflict ; simple no-op pour already_exists) — on se contente de
  // logguer ici, jamais de faire réessayer Stripe indéfiniment pour une
  // erreur applicative interne.
  if (result.error === 'stock_conflict') {
    console.info('[webhook] Event reservation stock conflict handled — intent:', intent.id);
  } else if (result.error === 'already_exists') {
    console.info('[webhook] Event reservation already created by concurrent retry — intent:', intent.id);
  } else {
    console.error('[webhook] Failed to create event reservation:', result.error, '— intent:', intent.id);
  }

  return NextResponse.json({ received: true });
}
