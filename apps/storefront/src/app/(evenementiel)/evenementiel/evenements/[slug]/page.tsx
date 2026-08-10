import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { IconCalendarEvent, IconMapPin, IconUsers } from '@tabler/icons-react';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatDate } from '@/lib/utils/format';
import EventCheckoutClient from './EventCheckoutClient';
import type { EventRow, EventTicketType } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createPublicClient();
  const { data: event } = await supabase
    .from('events')
    .select('title, description')
    .eq('tenant_id', tenant.id)
    .eq('slug', params.slug)
    .eq('status', 'published')
    .maybeSingle();

  return { title: event?.title ?? 'Événement' };
}

export default async function EventDetailPage({ params }: PageProps) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  if (!tenant.events_enabled) notFound();

  const supabase = createPublicClient();

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('slug', params.slug)
    .eq('status', 'published')
    .maybeSingle();

  if (!event) notFound();
  const eventRow = event as EventRow;

  const { data: ticketTypesRaw } = await supabase
    .from('event_ticket_types')
    .select('*')
    .eq('event_id', eventRow.id)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  const ticketTypes = (ticketTypesRaw ?? []) as EventTicketType[];
  const soldOut = eventRow.capacity_remaining <= 0;

  return (
    <div className="min-h-screen bg-[#f7f9f8]">
      <div
        className="h-48 sm:h-64 bg-cover bg-center flex items-end"
        style={{
          backgroundImage: eventRow.banner_image_url ? `url(${eventRow.banner_image_url})` : undefined,
          backgroundColor: eventRow.banner_image_url ? undefined : 'var(--color-primary)',
        }}
      />

      <div className="max-w-2xl mx-auto px-4 py-6">
        <p
          className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5"
          style={{ color: 'var(--color-primary)' }}
        >
          <IconCalendarEvent size={14} /> {formatDate(eventRow.date_start)}
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{eventRow.title}</h1>
        {eventRow.location && (
          <p className="text-sm text-gray-500 flex items-center gap-1.5 mb-2">
            <IconMapPin size={14} /> {eventRow.location}
          </p>
        )}
        <p className="text-sm text-gray-500 flex items-center gap-1.5 mb-4">
          <IconUsers size={14} />
          {soldOut ? 'Complet' : `${eventRow.capacity_remaining} place${eventRow.capacity_remaining > 1 ? 's' : ''} restante${eventRow.capacity_remaining > 1 ? 's' : ''}`}
        </p>

        {eventRow.description && (
          <p className="text-sm text-gray-700 whitespace-pre-line mb-6">{eventRow.description}</p>
        )}

        <EventCheckoutClient
          event={{ id: eventRow.id, slug: eventRow.slug, title: eventRow.title, capacityRemaining: eventRow.capacity_remaining }}
          ticketTypes={ticketTypes}
          tenant={{ currency: tenant.currency }}
          soldOut={soldOut}
        />
      </div>
    </div>
  );
}
