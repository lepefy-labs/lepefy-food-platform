import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { getTicketUrl } from '@/lib/events/ticketUrl';

// Rejoue la notification n8n '/webhook/event-reservation-confirmed' pour une
// réservation déjà existante (correction d'email, ou simple renvoi si le
// message est parti en spam). Ne touche ni au qr_token, ni à la capacité,
// ni à Stripe — relit l'état actuel et renvoie exactement le même payload
// que createEventReservationFromRequest.ts, pour que le template email
// Brevo/n8n existant l'interprète sans modification.

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

  const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
  await notifyN8n('/webhook/event-reservation-confirmed', {
    reservationId:  reservation.id,
    eventId:        reservation.event_id,
    customerName:   reservation.customer_name,
    customerEmail:  reservation.customer_email,
    customerPhone:  reservation.customer_phone,
    amountPaid:     reservation.amount_paid,
    ...eventDetails,
    items: typedItems.map((i) => ({
      reservation_id:  i.reservation_id,
      ticket_type_id:  i.ticket_type_id,
      quantity:        i.quantity,
      unit_price:      i.unit_price,
      ticketTypeLabel: labelByTicketType.get(i.ticket_type_id) ?? null,
    })),
    ticketUrl:  getTicketUrl(reservation.qr_token),
    adminLink:  `${storefrontUrl}/admin/evenementiel/evenements`,
  });

  console.info('[resendReservationConfirmation] Notification resent — reservation:', reservationId);

  return { success: true };
}
