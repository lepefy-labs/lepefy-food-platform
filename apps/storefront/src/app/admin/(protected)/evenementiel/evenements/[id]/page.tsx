import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import EventDetailAdminClient from './EventDetailAdminClient';
import type { EventRow, EventTicketType, EventReservation } from '@lepefy/types';

export const dynamic = 'force-dynamic';

export default async function AdminEventDetailPage({ params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!event) notFound();

  const { data: ticketTypes } = await supabase
    .from('event_ticket_types')
    .select('*')
    .eq('event_id', event.id)
    .order('sort_order', { ascending: true });

  const { data: reservations } = await supabase
    .from('event_reservations')
    .select('*')
    .eq('event_id', event.id)
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-4xl">
      <EventDetailAdminClient
        event={event as EventRow}
        initialTicketTypes={(ticketTypes ?? []) as EventTicketType[]}
        initialReservations={(reservations ?? []) as EventReservation[]}
        currency={tenant.currency}
      />
    </div>
  );
}
