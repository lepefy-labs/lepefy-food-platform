import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { IconCalendar, IconCircleCheck, IconClock, IconFlame, IconLock, IconMapPin, IconUsers } from '@tabler/icons-react';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { formatEventDayDate, formatEventTime } from '@/lib/utils/format';
import { EventImageFader } from '@/components/evenementiel/EventImageFader';
import { getHighlightIcon } from '@/lib/events/highlightIcons';
import { isE2ERequest } from '@/lib/e2e/isE2ERequest';
import EventCheckoutClient from './EventCheckoutClient';
import type { EventRow, EventTicketType } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const EVENT_MODULE_DEFAULT_PRIMARY = '#E65C00';
const EVENT_MODULE_DEFAULT_SECONDARY = '#FFB347';

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
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
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
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

  const allPaymentMethods = await getTenantPaymentMethods(tenant.id);
  const externalPaymentMethods = allPaymentMethods.filter(
    (m) => m.method !== 'bank_transfer' && m.method !== 'cash' && !!m.extra?.link
      && m.enabled_modules.includes('event'),
  );

  const { data: eventPhotosRaw } = await supabase
    .from('event_gallery_photos')
    .select('image_url')
    .eq('tenant_id', tenant.id)
    .eq('event_id', eventRow.id)
    .order('sort_order', { ascending: true });

  const eventImages = eventPhotosRaw && eventPhotosRaw.length > 0
    ? eventPhotosRaw.map((photo) => photo.image_url as string)
    : [eventRow.banner_image_url].filter((url): url is string => Boolean(url));

  const primaryColor = eventRow.theme_primary_color ?? EVENT_MODULE_DEFAULT_PRIMARY;
  const secondaryColor = eventRow.theme_secondary_color ?? EVENT_MODULE_DEFAULT_SECONDARY;
  const eventThemeStyle: CSSProperties = {
    '--color-primary': primaryColor,
    '--color-primary-dark': `color-mix(in srgb, ${primaryColor} 75%, black)`,
    '--color-secondary': secondaryColor,
  } as CSSProperties;

  const mapsHref = eventRow.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(eventRow.location)}`
    : null;
  const highlights = (eventRow.highlights ?? []).slice(0, 3);

  const featureRow = highlights.length > 0 && (
    <section className="rounded-3xl border border-black/[0.06] bg-[#fffaf3] p-5 sm:p-6">
      <h2 className="font-display text-xl font-semibold text-gray-900">Ce qui vous attend</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {highlights.map((highlight, i) => {
          const Icon = getHighlightIcon(highlight.icon);
          return (
            <div key={i} className="text-center">
              <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] text-[var(--color-primary)]">
                <Icon size={22} stroke={1.8} />
              </div>
              <p className="mt-3 text-sm font-bold text-gray-900">{highlight.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{highlight.text}</p>
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-[#f7f3eb]" style={eventThemeStyle}>
      <section className="relative isolate overflow-hidden bg-[#17130f] text-white">
        <EventImageFader images={eventImages} fallbackColor="var(--color-primary)" className="absolute inset-0 h-full w-full">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,10,8,.92)_0%,rgba(12,10,8,.68)_52%,rgba(12,10,8,.22)_100%)]" aria-hidden="true" />
        </EventImageFader>
        <div className="relative z-[2] mx-auto flex min-h-[430px] max-w-[1180px] items-end px-4 py-10 sm:min-h-[500px] sm:px-6 sm:py-14">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary)] px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-white">
              <IconFlame size={14} /> ÉVÉNEMENT
            </span>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.02] sm:text-6xl">{eventRow.title}</h1>
            {eventRow.subtitle && <p className="mt-2 font-display text-xl italic text-[var(--color-secondary)] sm:text-2xl">{eventRow.subtitle}</p>}
            {eventRow.description && <p className="mt-5 max-w-xl whitespace-pre-line text-sm leading-relaxed text-white/80 sm:text-base">{eventRow.description}</p>}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[980px] px-4 pb-16 sm:px-6">
        <section className="relative z-[3] -mt-7 grid overflow-hidden rounded-3xl border border-black/[0.06] bg-white shadow-[0_18px_45px_rgba(50,37,20,.1)] sm:grid-cols-4">
          <div className="flex min-h-[92px] items-start gap-3 border-b border-black/[0.06] p-4 sm:border-b-0 sm:border-r">
            <IconCalendar size={19} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Date</p><p className="mt-1 text-sm font-semibold text-gray-900">{formatEventDayDate(eventRow.date_start)}</p></div>
          </div>
          <div className="flex min-h-[92px] items-start gap-3 border-b border-black/[0.06] p-4 sm:border-b-0 sm:border-r">
            <IconClock size={19} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Heure</p><p className="mt-1 text-sm font-semibold text-gray-900">{formatEventTime(eventRow.date_start)}</p></div>
          </div>
          <div className="flex min-h-[92px] items-start gap-3 border-b border-black/[0.06] p-4 sm:border-b-0 sm:border-r">
            <IconMapPin size={19} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Lieu</p><p className="mt-1 line-clamp-2 text-sm font-semibold text-gray-900">{eventRow.location ?? 'À confirmer'}</p>{mapsHref && <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline">Voir sur la carte</a>}</div>
          </div>
          <div className="flex min-h-[92px] items-start gap-3 p-4">
            <IconUsers size={19} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Disponibilité</p><p className={`mt-1 text-sm font-semibold ${soldOut ? 'text-red-600' : 'text-green-700'}`}>{soldOut ? 'Complet' : `${eventRow.capacity_remaining} place${eventRow.capacity_remaining > 1 ? 's' : ''} restante${eventRow.capacity_remaining > 1 ? 's' : ''}`}</p></div>
          </div>
        </section>

        <div className="py-9 sm:py-12">
          <EventCheckoutClient
            event={{ id: eventRow.id, slug: eventRow.slug, title: eventRow.title, capacityRemaining: eventRow.capacity_remaining }}
            ticketTypes={ticketTypes}
            tenant={{ currency: tenant.currency }}
            soldOut={soldOut}
            featureRow={featureRow}
            externalPaymentMethods={externalPaymentMethods}
            isE2ETest={isE2ERequest()}
          />

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-gray-500">
            <span className="flex items-center gap-2"><IconLock size={17} className="text-[var(--color-primary)]" />Paiement sécurisé</span>
            <span className="flex items-center gap-2"><IconCircleCheck size={17} className="text-[var(--color-primary)]" />Réservation confirmée après paiement</span>
          </div>
        </div>
      </main>
    </div>
  );
}
