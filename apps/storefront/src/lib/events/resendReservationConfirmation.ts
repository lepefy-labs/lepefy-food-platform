import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEventReservationConfirmation } from '@/lib/events/sendEventReservationConfirmation';
import { getTicketUrl } from '@/lib/events/ticketUrl';

// Renvoie la confirmation de réservation d'une réservation déjà existante
// (correction d'email, ou simple renvoi si le message est parti en spam).
// Ne touche ni au qr_token, ni à la capacité, ni à Stripe — relit l'état
// actuel et produit le même email que createEventReservationFromRequest.ts
// (sendEventReservationConfirmation, template in-app via send-email).

export type ResendReservationConfirmationResult = { success: true } | { error: string };

export async function resendReservationConfirmation(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<ResendReservationConfirmationResult> {
  const { data: reservation, error: reservationError } = await supabase
    .from('event_reservations')
    .select('id, tenant_id, event_id, customer_name, customer_email, customer_phone, amount_paid, qr_token, status')
    .eq('id', reservationId)
    .maybeSingle();

  if (reservationError || !reservation) {
    console.error('[resendReservationConfirmation] Reservation not found:', reservationError, '— id:', reservationId);
    return { error: 'not_found' };
  }

  const { data: reservationItems } = await supabase
    .from('event_reservation_items')
    .select('id, reservation_id, ticket_type_id, quantity, unit_price')
    .eq('reservation_id', reservationId);

  const typedItems = (reservationItems ?? []) as { id: string; reservation_id: string; ticket_type_id: string; quantity: number; unit_price: number }[];

  const { data: ticketTypes } = await supabase
    .from('event_ticket_types')
    .select('id, label')
    .eq('event_id', reservation.event_id)
    .in('id', typedItems.map((i) => i.ticket_type_id));

  const labelByTicketType = new Map<string, string>(
    ((ticketTypes ?? []) as { id: string; label: string }[]).map((t) => [t.id, t.label]),
  );

  const { data: eventRow } = await supabase
    .from('events')
    .select('title, date_start, location')
    .eq('id', reservation.event_id)
    .maybeSingle();

  const eventDetails = {
    eventTitle:     eventRow?.title ?? null,
    eventDateStart: eventRow?.date_start ?? null,
    eventLocation:  eventRow?.location ?? null,
  };

  await sendEventReservationConfirmation({
    tenantId: reservation.tenant_id,
    // Each explicit resend is a new message (fresh key), still retried on failure.
    idempotencyKey: `event-reservation-resend:${reservation.id}:${crypto.randomUUID()}`,
    customerName: reservation.customer_name,
    customerEmail: reservation.customer_email,
    amountPaid: reservation.amount_paid,
    ...eventDetails,
    items: typedItems.map((i) => ({
      quantity: i.quantity,
      label: labelByTicketType.get(i.ticket_type_id) ?? null,
      unitPrice: i.unit_price,
    })),
    ticketUrl: getTicketUrl(reservation.qr_token),
  });

  console.info('[resendReservationConfirmation] Notification resent — reservation:', reservationId);

  return { success: true };
}
