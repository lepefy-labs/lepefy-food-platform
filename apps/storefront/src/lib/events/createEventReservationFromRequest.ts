import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { generateEventQrToken } from '@/lib/events/qrToken';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { getTicketUrl } from '@/lib/events/ticketUrl';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import type { EventCheckoutItemInput } from '@lepefy/types';

const stripe = getStripeClient('event');

// Extrait de handleEventReservationPaymentSucceeded (api/webhooks/stripe/route.ts)
// — même logique bit-à-bit pour le flux stripe, réutilisée telle quelle par
// api/admin/evenementiel/reservation-requests/[id]/confirm-payment (Phase 2 —
// paiement via lien externe, confirmation manuelle). Seule différence entre
// les deux appelants : le remboursement automatique Stripe en cas de conflit
// de capacité, impossible pour external_link (aucun PaymentIntent) — géré
// ci-dessous via `input.stripePaymentIntentId === undefined`.

export interface CreateEventReservationInput {
  eventId:        string;
  tenantId:       string;
  items:          EventCheckoutItemInput[];
  customerName:   string;
  customerEmail:  string;
  customerPhone:  string;
  amountPaid:     number;
  /** intent.id — présent uniquement pour le flux Stripe. undefined pour external_link. */
  stripePaymentIntentId?: string;
  /** Agente e2e Fase 0 — true uniquement quand appelé depuis le webhook pour
   *  un événement vérifié contre le compte Stripe séparé dédié aux tests e2e.
   *  Absent (donc false) pour tous les autres appelants (external_link). */
  isTest?: boolean;
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

  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  if (totalQuantity <= 0) {
    console.error('[createEventReservationFromRequest] No items to reserve — event:', eventId);
    return { error: 'no_items' };
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

  // Vérification atomique et définitive — jamais allentée pour external_link :
  // si la capacité a été épuisée entre-temps par une autre réservation
  // confirmée, ceci échoue exactement comme pour Stripe.
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
        await stripe.refunds.create({ payment_intent: input.stripePaymentIntentId });
        refundSucceeded = true;
        console.info('[createEventReservationFromRequest] Refund issued (capacity conflict) — intent:', input.stripePaymentIntentId);
      } catch (refundErr) {
        console.error('[createEventReservationFromRequest] Refund FAILED — intent:', input.stripePaymentIntentId,
          '— needs manual refund:', refundErr);
      }
    }

    await notifyN8n('/webhook/event-reservation-capacity-conflict', {
      eventId, intentId: input.stripePaymentIntentId ?? null, customerName, customerEmail,
      refundSucceeded: isStripe ? refundSucceeded : null,
      manualRefundRequired: !isStripe,
      ...eventDetails,
      // Pas de ticketUrl ici : la réservation n'est pas créée, aucun billet
      // valide à montrer.
    });

    return { error: 'stock_conflict' };
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
      stripe_payment_intent_id:  input.stripePaymentIntentId ?? null,
      amount_paid:               amountPaid,
      qr_token:                  qrToken,
      quantity_total:            totalQuantity,
      quantity_remaining:        totalQuantity,
      status:                    'confirmed',
      is_test:                   input.isTest ?? false,
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

  const itemsPayload = items.map((i) => ({
    reservation_id: reservationId,
    ticket_type_id: i.ticket_type_id,
    quantity:       i.quantity,
    unit_price:     priceByTicketType.get(i.ticket_type_id) ?? 0,
  }));

  const { error: itemsError } = await supabase.from('event_reservation_items').insert(itemsPayload);
  if (itemsError) {
    console.error('[createEventReservationFromRequest] Failed to insert reservation items:', itemsError, '— reservation:', reservationId);
  }

  console.info('[createEventReservationFromRequest] Reservation created — id:', reservationId, '— event:', eventId, '— qty:', totalQuantity);

  const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
  await notifyN8n('/webhook/event-reservation-confirmed', {
    reservationId, eventId, customerName, customerEmail, customerPhone,
    amountPaid,
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

  return { reservationId };
}
