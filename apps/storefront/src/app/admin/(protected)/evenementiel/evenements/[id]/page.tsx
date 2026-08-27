import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import EventDetailAdminClient from './EventDetailAdminClient';
import type { EventRow, EventTicketType, EventReservation, EventReservationItem, EventReservationRequest } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export type AdminEventReservationItem = EventReservationItem & {
  ticket_type_label: string;
};

export type AdminEventReservation = EventReservation & {
  items: AdminEventReservationItem[];
};

export default async function AdminEventDetailPage({ params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!event) notFound();

  const [{ data: ticketTypes }, { data: reservations }, { data: pendingRequests }] = await Promise.all([
    supabase
      .from('event_ticket_types')
      .select('*')
      .eq('event_id', event.id)
      .eq('tenant_id', tenant.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('event_reservations')
      .select('*')
      .eq('event_id', event.id)
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('event_reservation_requests')
      .select('*')
      .eq('event_id', event.id)
      .eq('tenant_id', tenant.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  ]);

  const reservationRows = (reservations ?? []) as EventReservation[];
  const reservationIds = reservationRows.map((reservation) => reservation.id);
  const { data: reservationItems } = reservationIds.length > 0
    ? await supabase
        .from('event_reservation_items')
        .select('id, reservation_id, ticket_type_id, quantity, unit_price')
        .in('reservation_id', reservationIds)
    : { data: [] as EventReservationItem[] };

  const labelByTicketType = new Map(
    ((ticketTypes ?? []) as EventTicketType[]).map((ticket) => [ticket.id, ticket.label]),
  );
  const itemsByReservation = new Map<string, AdminEventReservationItem[]>();
  for (const item of (reservationItems ?? []) as EventReservationItem[]) {
    const current = itemsByReservation.get(item.reservation_id) ?? [];
    current.push({ ...item, ticket_type_label: labelByTicketType.get(item.ticket_type_id) ?? 'Formule' });
    itemsByReservation.set(item.reservation_id, current);
  }

  const enrichedReservations: AdminEventReservation[] = reservationRows.map((reservation) => ({
    ...reservation,
    items: itemsByReservation.get(reservation.id) ?? [],
  }));

  return (
    <div className="mx-auto w-full max-w-7xl">
      <EventDetailAdminClient
        event={event as EventRow}
        initialTicketTypes={(ticketTypes ?? []) as EventTicketType[]}
        initialReservations={enrichedReservations}
        initialPendingRequests={(pendingRequests ?? []) as EventReservationRequest[]}
        currency={tenant.currency}
      />
    </div>
  );
}
