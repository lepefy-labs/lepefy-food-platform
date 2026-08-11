import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { generateEventQrToken } from '@/lib/events/qrToken';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { getTicketUrl } from '@/lib/events/ticketUrl';
import { createOrderFromCheckoutSession, type CheckoutSessionRow } from '@/lib/orders/createOrderFromCheckoutSession';
import type { EventCheckoutItemInput, RentalCheckoutItemInput } from '@lepefy/types';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ─── Module Événementiel (052) — payment_intent.succeeded branches ──────────
// Ajoutés en AMONT du flux commandes existant (metadata.type absent pour toute
// commande boutique classique — cf. POST /api/checkout — donc ces branches ne
// changent rien à ce flux). Ne touche jamais orders/checkout_sessions.

async function handleEventReservationPaymentSucceeded(intent: Stripe.PaymentIntent): Promise<NextResponse> {
  const supabase       = createServiceClient();
  const eventId        = intent.metadata?.event_id;
  const tenantId       = intent.metadata?.tenant_id;
  const customerName   = intent.metadata?.customer_name ?? '';
  const customerEmail  = intent.metadata?.customer_email ?? '';
  const customerPhone  = intent.metadata?.customer_phone ?? '';

  console.info('[webhook/events] payment_intent.succeeded (event_reservation) — intent:', intent.id, '— event_id:', eventId);

  if (!eventId || !tenantId) {
    console.error('[webhook/events] Missing event_id/tenant_id in metadata — intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  const { data: existing } = await supabase
    .from('event_reservations')
    .select('id')
    .eq('stripe_payment_intent_id', intent.id)
    .maybeSingle();

  if (existing) {
    console.info('[webhook/events] Reservation already exists for intent:', intent.id, '— skipping');
    return NextResponse.json({ received: true });
  }

  let items: EventCheckoutItemInput[] = [];
  try {
    items = JSON.parse(intent.metadata?.items ?? '[]');
  } catch {
    console.error('[webhook/events] Invalid items JSON in metadata — intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  if (totalQuantity <= 0) {
    console.error('[webhook/events] No items to reserve — intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  const { data: ticketTypes } = await supabase
    .from('event_ticket_types')
    .select('id, price, label')
    .eq('event_id', eventId)
    .in('id', items.map((i) => i.ticket_type_id));

  const typedTicketTypes = (ticketTypes ?? []) as { id: string; price: number; label: string }[];
  const priceByTicketType = new Map<string, number>(typedTicketTypes.map((t) => [t.id, t.price]));
  const labelByTicketType = new Map<string, string>(typedTicketTypes.map((t) => [t.id, t.label]));

  // Données événement résolues ICI (pas déléguées à n8n) pour les payloads
  // des deux webhooks (confirmé + conflit capacité) — templates email
  // lisibles sans query supplémentaire côté n8n.
  const { data: eventRow } = await supabase
    .from('events')
    .select('title, date_start, location')
    .eq('id', eventId)
    .maybeSingle();

  const eventDetails = {
    eventTitle:     eventRow?.title ?? null,
    eventDateStart: eventRow?.date_start ?? null,
    eventLocation:  eventRow?.location ?? null,
  };

  const reservationId = crypto.randomUUID();
  const qrToken        = generateEventQrToken(reservationId, eventId);

  const { data: capacityResult, error: capacityError } = await supabase
    .rpc('reserve_event_capacity', { p_event_id: eventId, p_quantity: totalQuantity })
    .single();

  const capacity = capacityResult as { success: boolean; remaining: number } | null;

  if (capacityError || !capacity?.success) {
    console.error('[webhook/events] Capacity reservation failed — intent:', intent.id,
      '— reason:', capacityError ?? 'insufficient capacity');

    let refundSucceeded = false;
    try {
      await stripe.refunds.create({ payment_intent: intent.id });
      refundSucceeded = true;
      console.info('[webhook/events] Refund issued (capacity conflict) — intent:', intent.id);
    } catch (refundErr) {
      console.error('[webhook/events] Refund FAILED — intent:', intent.id, '— needs manual refund:', refundErr);
    }

    await notifyN8n('/webhook/event-reservation-capacity-conflict', {
      eventId, intentId: intent.id, customerName, customerEmail, refundSucceeded,
      ...eventDetails,
      // Pas de ticketUrl ici : la réservation n'est pas créée, aucun billet
      // valide à montrer.
    });

    return NextResponse.json({ received: true });
  }

  const { error: reservationError } = await supabase
    .from('event_reservations')
    .insert({
      id:                        reservationId,
      tenant_id:                 tenantId,
      event_id:                  eventId,
      customer_name:             customerName,
      customer_email:            customerEmail,
      customer_phone:            customerPhone || null,
      stripe_payment_intent_id:  intent.id,
      amount_paid:               intent.amount / 100,
      qr_token:                  qrToken,
      quantity_total:            totalQuantity,
      quantity_remaining:        totalQuantity,
      status:                    'confirmed',
    });

  if (reservationError) {
    if ((reservationError as { code?: string }).code === '23505') {
      console.info('[webhook/events] Reservation already created by concurrent retry — intent:', intent.id);
      return NextResponse.json({ received: true });
    }
    console.error('[webhook/events] Failed to create reservation AFTER capacity decrement — needs manual review:',
      reservationError, '— intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  const itemsPayload = items.map((i) => ({
    reservation_id: reservationId,
    ticket_type_id: i.ticket_type_id,
    quantity:       i.quantity,
    unit_price:     priceByTicketType.get(i.ticket_type_id) ?? 0,
  }));

  const { error: itemsError } = await supabase.from('event_reservation_items').insert(itemsPayload);
  if (itemsError) {
    console.error('[webhook/events] Failed to insert reservation items:', itemsError, '— reservation:', reservationId);
  }

  console.info('[webhook/events] Reservation created — id:', reservationId, '— event:', eventId, '— qty:', totalQuantity);

  const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
  await notifyN8n('/webhook/event-reservation-confirmed', {
    reservationId, eventId, customerName, customerEmail, customerPhone,
    amountPaid: intent.amount / 100,
    ...eventDetails,
    // ticketTypeLabel ajouté UNIQUEMENT dans le payload n8n — itemsPayload
    // reste inchangé pour l'insert event_reservation_items (pas de colonne
    // label dans cette table).
    items: itemsPayload.map((i) => ({
      ...i,
      ticketTypeLabel: labelByTicketType.get(i.ticket_type_id) ?? null,
    })),
    ticketUrl:  getTicketUrl(qrToken),
    adminLink:  `${storefrontUrl}/admin/evenementiel/evenements`,
  });

  return NextResponse.json({ received: true });
}

async function handleRentalReservationPaymentSucceeded(intent: Stripe.PaymentIntent): Promise<NextResponse> {
  const supabase           = createServiceClient();
  const serviceOfferingId  = intent.metadata?.service_offering_id;
  const tenantId           = intent.metadata?.tenant_id;
  const pickupDate         = intent.metadata?.pickup_date ?? '';
  const customerName       = intent.metadata?.customer_name ?? '';
  const customerEmail      = intent.metadata?.customer_email ?? '';
  const customerPhone      = intent.metadata?.customer_phone ?? '';

  console.info('[webhook/rental] payment_intent.succeeded (rental_reservation) — intent:', intent.id,
    '— service_offering_id:', serviceOfferingId);

  if (!serviceOfferingId || !tenantId || !pickupDate) {
    console.error('[webhook/rental] Missing metadata — intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  const { data: existing } = await supabase
    .from('rental_reservations')
    .select('id')
    .eq('stripe_payment_intent_id', intent.id)
    .maybeSingle();

  if (existing) {
    console.info('[webhook/rental] Reservation already exists for intent:', intent.id, '— skipping');
    return NextResponse.json({ received: true });
  }

  let items: RentalCheckoutItemInput[] = [];
  try {
    items = JSON.parse(intent.metadata?.items ?? '[]');
  } catch {
    console.error('[webhook/rental] Invalid items JSON in metadata — intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  if (items.length === 0) {
    console.error('[webhook/rental] No items to reserve — intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  const { data: rentalItems } = await supabase
    .from('rental_items')
    .select('id, price_per_unit')
    .in('id', items.map((i) => i.rental_item_id));

  const priceByItem = new Map<string, number>(
    ((rentalItems ?? []) as { id: string; price_per_unit: number }[]).map((r) => [r.id, r.price_per_unit]),
  );

  // Décrément atomique de chaque article, un par un — rollback (restore) de
  // ce qui a déjà été décrémenté si un article échoue en cours de boucle.
  const reservedSoFar: { rental_item_id: string; quantity: number }[] = [];
  let stockConflict = false;

  for (const item of items) {
    const { data: result, error } = await supabase
      .rpc('reserve_rental_stock', { p_rental_item_id: item.rental_item_id, p_quantity: item.quantity })
      .single();

    const typedResult = result as { success: boolean; remaining: number } | null;

    if (error || !typedResult?.success) {
      stockConflict = true;
      console.error('[webhook/rental] Stock reservation failed — intent:', intent.id,
        '— item:', item.rental_item_id, '— reason:', error ?? 'insufficient stock');
      break;
    }
    reservedSoFar.push(item);
  }

  if (stockConflict) {
    for (const item of reservedSoFar) {
      await supabase.rpc('restore_rental_stock', { p_rental_item_id: item.rental_item_id, p_quantity: item.quantity });
    }

    let refundSucceeded = false;
    try {
      await stripe.refunds.create({ payment_intent: intent.id });
      refundSucceeded = true;
      console.info('[webhook/rental] Refund issued (stock conflict) — intent:', intent.id);
    } catch (refundErr) {
      console.error('[webhook/rental] Refund FAILED — intent:', intent.id, '— needs manual refund:', refundErr);
    }

    await notifyN8n('/webhook/rental-reservation-stock-conflict', {
      serviceOfferingId, intentId: intent.id, customerName, customerEmail, refundSucceeded,
    });

    return NextResponse.json({ received: true });
  }

  const { data: reservation, error: reservationError } = await supabase
    .from('rental_reservations')
    .insert({
      tenant_id:                 tenantId,
      service_offering_id:       serviceOfferingId,
      customer_name:             customerName,
      customer_email:            customerEmail,
      customer_phone:            customerPhone || null,
      pickup_date:               pickupDate,
      stripe_payment_intent_id:  intent.id,
      amount_paid:               intent.amount / 100,
      status:                    'confirmed',
    })
    .select('id')
    .single();

  if (reservationError || !reservation) {
    if ((reservationError as { code?: string } | null)?.code === '23505') {
      console.info('[webhook/rental] Reservation already created by concurrent retry — intent:', intent.id);
      return NextResponse.json({ received: true });
    }
    console.error('[webhook/rental] Failed to create reservation AFTER stock decrement — needs manual review:',
      reservationError, '— intent:', intent.id);
    return NextResponse.json({ received: true });
  }

  const itemsPayload = items.map((i) => ({
    reservation_id: reservation.id,
    rental_item_id: i.rental_item_id,
    quantity:       i.quantity,
    unit_price:     priceByItem.get(i.rental_item_id) ?? 0,
  }));

  const { error: itemsError } = await supabase.from('rental_reservation_items').insert(itemsPayload);
  if (itemsError) {
    console.error('[webhook/rental] Failed to insert reservation items:', itemsError, '— reservation:', reservation.id);
  }

  console.info('[webhook/rental] Reservation created — id:', reservation.id, '— service:', serviceOfferingId);

  const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
  await notifyN8n('/webhook/rental-reservation-confirmed', {
    reservationId: reservation.id, serviceOfferingId, customerName, customerEmail, customerPhone,
    pickupDate, amountPaid: intent.amount / 100, items: itemsPayload,
    adminLink: `${storefrontUrl}/admin/evenementiel/reservations-materiel`,
  });

  return NextResponse.json({ received: true });
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
    const intent = event.data.object as Stripe.PaymentIntent;

    // ── Module Événementiel (052) — routes vers les branches dédiées avant
    // toute logique commande boutique : ces PaymentIntents n'ont jamais de
    // session_id (créés par /api/events/[id]/checkout et
    // /api/rental/checkout, pas par /api/checkout), le flux ci-dessous ne
    // les voit donc jamais.
    if (intent.metadata?.type === 'event_reservation') {
      return handleEventReservationPaymentSucceeded(intent);
    }
    if (intent.metadata?.type === 'rental_reservation') {
      return handleRentalReservationPaymentSucceeded(intent);
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
      .maybeSingle() as { data: CheckoutSessionRow | null; error: unknown };

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

    const result = await createOrderFromCheckoutSession(
      supabase,
      { ...checkoutSession, tenant_id: resolvedTenantId },
      { stripePaymentIntentId: intent.id },
    );

    if ('error' in result) {
      console.error('[webhook] createOrderFromCheckoutSession failed:', result.error, '— intent:', intent.id);
      return NextResponse.json({ received: true });
    }

    console.info('[webhook] Order resolved — id:', result.order.id, '— status:', result.order.status);
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
