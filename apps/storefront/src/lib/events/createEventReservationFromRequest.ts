import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import Stripe from 'stripe';
import { generateEventQrToken } from '@/lib/events/qrToken';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { getTicketUrl } from '@/lib/events/ticketUrl';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import type { EventCheckoutItemInput, EventReservationPaymentMethod, EventReservationSource } from '@lepefy/types';

export interface CreateEventReservationInput {
  eventId: string;
  tenantId: string;
  items: EventCheckoutItemInput[];
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  amountPaid: number;
  /** intent.id — présent uniquement pour le flux Stripe. */
  stripePaymentIntentId?: string;
  isTest?: boolean;
  /** Par défaut dérivé du flux : online si Stripe, external_link sinon. */
  source?: EventReservationSource;
  /** Par défaut dérivé du flux : stripe si PaymentIntent, external_link sinon. */
  paymentMethod?: EventReservationPaymentMethod;
  /** Admin ayant créé une réservation encaissée en magasin. */
  createdByAdminId?: string | null;
}

export type CreateEventReservationResult =
  | { reservationId: string }
  | { error: 'stock_conflict' | string };

export async function createEventReservationFromRequest(
  supabase: SupabaseClient,
  input: CreateEventReservationInput,
): Promise<CreateEventReservationResult> {
  const isStripe = input.stripePaymentIntentId !== undefined;
  const { eventId, tenantId, items, customerName, customerEmail, customerPhone, amountPaid } = input;
  const source: EventReservationSource = input.source ?? (isStripe ? 'online' : 'external_link');
  const paymentMethod: EventReservationPaymentMethod = input.paymentMethod ?? (isStripe ? 'stripe' : 'external_link');

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity <= 0) {
    console.error('[createEventReservationFromRequest] No items to reserve — event:', eventId);
    return { error: 'no_items' };
  }

  const { data: ticketTypes } = await supabase
    .from('event_ticket_types')
    .select('id, price, label')
    .eq('event_id', eventId)
    .in('id', items.map((item) => item.ticket_type_id));

  const typedTicketTypes = (ticketTypes ?? []) as { id: string; price: number; label: string }[];
  const priceByTicketType = new Map<string, number>(typedTicketTypes.map((ticket) => [ticket.id, ticket.price]));
  const labelByTicketType = new Map<string, string>(typedTicketTypes.map((ticket) => [ticket.id, ticket.label]));

  const { data: eventRow } = await supabase
    .from('events')
    .select('title, date_start, location')
    .eq('id', eventId)
    .maybeSingle();

  const eventDetails = {
    eventTitle: eventRow?.title ?? null,
    eventDateStart: eventRow?.date_start ?? null,
    eventLocation: eventRow?.location ?? null,
  };

  const reservationId = crypto.randomUUID();
  const qrToken = generateEventQrToken(reservationId, eventId);

  const { data: capacityResult, error: capacityError } = await supabase
    .rpc('reserve_event_capacity', { p_event_id: eventId, p_quantity: totalQuantity })
    .single();

  const capacity = capacityResult as { success: boolean; remaining: number } | null;

  if (capacityError || !capacity?.success) {
    console.error('[createEventReservationFromRequest] Capacity reservation failed — event:', eventId,
      '— reason:', capacityError ?? 'insufficient capacity');

    let refundSucceeded = false;
    if (isStripe && input.stripePaymentIntentId) {
      try {
        const refundStripe = input.isTest
          ? new Stripe(process.env.STRIPE_SECRET_KEY_TEST ?? '')
          : getStripeClient('event');
        await refundStripe.refunds.create({ payment_intent: input.stripePaymentIntentId });
        refundSucceeded = true;
        console.info('[createEventReservationFromRequest] Refund issued (capacity conflict) — intent:', input.stripePaymentIntentId);
      } catch (refundErr) {
        console.error('[createEventReservationFromRequest] Refund FAILED — intent:', input.stripePaymentIntentId,
          '— needs manual refund:', refundErr);
      }
    }

    await notifyN8n('/webhook/event-reservation-capacity-conflict', {
      eventId,
      intentId: input.stripePaymentIntentId ?? null,
      customerName,
      customerEmail,
      refundSucceeded: isStripe ? refundSucceeded : null,
      manualRefundRequired: !isStripe,
      source,
      paymentMethod,
      ...eventDetails,
    });

    return { error: 'stock_conflict' };
  }

  const { error: reservationError } = await supabase
    .from('event_reservations')
    .insert({
      id: reservationId,
      tenant_id: tenantId,
      event_id: eventId,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
      amount_paid: amountPaid,
      qr_token: qrToken,
      quantity_total: totalQuantity,
      quantity_remaining: totalQuantity,
      status: 'confirmed',
      is_test: input.isTest ?? false,
      source,
      payment_method: paymentMethod,
      created_by_admin_id: input.createdByAdminId ?? null,
    });

  if (reservationError) {
    if ((reservationError as { code?: string }).code === '23505') {
      console.info('[createEventReservationFromRequest] Reservation already created by concurrent retry — event:', eventId);
      return { error: 'already_exists' };
    }
    console.error('[createEventReservationFromRequest] Failed to create reservation AFTER capacity decrement — needs manual review:',
      reservationError, '— event:', eventId);
    return { error: 'reservation_insert_failed' };
  }

  const itemsPayload = items.map((item) => ({
    reservation_id: reservationId,
    ticket_type_id: item.ticket_type_id,
    quantity: item.quantity,
    unit_price: priceByTicketType.get(item.ticket_type_id) ?? 0,
  }));

  const { error: itemsError } = await supabase.from('event_reservation_items').insert(itemsPayload);
  if (itemsError) {
    console.error('[createEventReservationFromRequest] Failed to insert reservation items:', itemsError, '— reservation:', reservationId);
  }

  console.info('[createEventReservationFromRequest] Reservation created — id:', reservationId, '— event:', eventId, '— qty:', totalQuantity, '— source:', source);

  const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
  await notifyN8n('/webhook/event-reservation-confirmed', {
    reservationId,
    eventId,
    customerName,
    customerEmail,
    customerPhone,
    amountPaid,
    source,
    paymentMethod,
    ...eventDetails,
    items: itemsPayload.map((item) => ({
      ...item,
      ticketTypeLabel: labelByTicketType.get(item.ticket_type_id) ?? null,
    })),
    ticketUrl: getTicketUrl(qrToken),
    adminLink: `${storefrontUrl}/admin/evenementiel/evenements`,
  });

  return { reservationId };
}
