import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { IconCalendar, IconCircleCheck, IconClock, IconExternalLink, IconFlame, IconLock, IconMapPin, IconUsers } from '@tabler/icons-react';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { formatEventDayDate, formatEventTime, formatPrice } from '@/lib/utils/format';
import { EventImageFader } from '@/components/evenementiel/EventImageFader';
import { getHighlightIcon } from '@/lib/events/highlightIcons';
import { isE2ERequest } from '@/lib/e2e/isE2ERequest';
import EventCheckoutClient from './EventCheckoutClient';
import EventSocialShare from './EventSocialShare';
import type { EventGalleryPhoto, EventRow, EventTicketType } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const EVENT_MODULE_DEFAULT_PRIMARY = '#E65C00';
const EVENT_MODULE_DEFAULT_SECONDARY = '#FFB347';

interface PageProps {
  params: { slug: string };
}

function availabilityClasses(remaining: number) {
  if (remaining <= 10) return 'border-red-200 bg-red-50 text-red-700';
  if (remaining <= 25) return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function availabilityLabel(remaining: number) {
  if (remaining <= 0) return 'Complet';
  if (remaining <= 25) return `Plus que ${remaining} place${remaining > 1 ? 's' : ''}`;
  return 'Encore beaucoup de places';
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createPublicClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, title, description, banner_image_url')
    .eq('tenant_id', tenant.id)
    .eq('slug', params.slug)
    .eq('status', 'published')
    .maybeSingle();

  if (!event) return { title: 'Événement' };

  const { data: photos } = await supabase
    .from('event_gallery_photos')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('event_id', event.id)
    .order('sort_order', { ascending: true });
  const socialImage = (photos ?? []).find((photo) => Boolean((photo as { is_social_share?: boolean }).is_social_share))?.image_url
    ?? event.banner_image_url
    ?? undefined;
  const description = event.description ?? `Découvrez ${event.title} chez ${tenant.name}.`;

  return {
    title: event.title,
    description,
    openGraph: {
      title: event.title,
      description,
      type: 'website',
      images: socialImage ? [{ url: socialImage }] : undefined,
    },
  };
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
  const minPrice = ticketTypes.length > 0 ? Math.min(...ticketTypes.map((ticket) => ticket.price)) : null;
  const soldOut = eventRow.capacity_remaining <= 0;

  const allPaymentMethods = await getTenantPaymentMethods(tenant.id);
  const externalPaymentMethods = allPaymentMethods.filter(
    (m) => m.method !== 'bank_transfer' && m.method !== 'cash' && !!m.extra?.link
      && m.enabled_modules.includes('event'),
  );

  const { data: eventPhotosRaw } = await supabase
    .from('event_gallery_photos')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('event_id', eventRow.id)
    .order('sort_order', { ascending: true });

  const eventPhotos = (eventPhotosRaw ?? []).map((photo) => ({
    ...photo,
    is_social_share: Boolean((photo as { is_social_share?: boolean }).is_social_share),
  })) as EventGalleryPhoto[];
  const eventImages = eventPhotos.length > 0
    ? eventPhotos.map((photo) => photo.image_url)
    : [eventRow.banner_image_url].filter((url): url is string => Boolean(url));
  const socialPhotos = eventPhotos.filter((photo) => photo.is_social_share);

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
    <section className="rounded-[22px] border border-black/[0.06] bg-[#fffaf3] p-4 sm:p-5">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">L’expérience</p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-gray-900">Ce qui vous attend</h2>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {highlights.map((highlight, i) => {
          const Icon = getHighlightIcon(highlight.icon);
          return (
            <div key={i} className="rounded-2xl bg-white/70 p-3 text-center">
              <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] text-[var(--color-primary)]">
                <Icon size={18} stroke={1.8} />
              </div>
              <p className="mt-2.5 text-sm font-bold text-gray-900">{highlight.title}</p>
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
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,10,8,.9)_0%,rgba(12,10,8,.66)_48%,rgba(12,10,8,.24)_100%)]" aria-hidden="true" />
        </EventImageFader>
        <div className="relative z-[2] mx-auto flex min-h-[305px] max-w-[1180px] items-end px-4 pb-10 pt-14 sm:min-h-[350px] sm:px-6 sm:pb-11">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary)] px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-white">
                <IconFlame size={14} /> ÉVÉNEMENT À VENIR
              </span>
              {minPrice != null && (
                <span className="rounded-full border border-white/25 bg-black/25 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur-sm">
                  À partir de {formatPrice(minPrice, tenant.currency)}
                </span>
              )}
            </div>
            <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.02] sm:text-[3.4rem]">{eventRow.title}</h1>
            {eventRow.subtitle && <p className="mt-1.5 font-display text-xl italic text-[var(--color-secondary)] sm:text-2xl">{eventRow.subtitle}</p>}
            {eventRow.description && <p className="mt-3 max-w-xl whitespace-pre-line text-sm leading-relaxed text-white/82 sm:text-[15px]">{eventRow.description}</p>}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1040px] px-4 pb-16 sm:px-6">
        <section className="relative z-[3] -mt-7 grid overflow-hidden rounded-[24px] border border-black/[0.06] bg-white shadow-[0_16px_36px_rgba(50,37,20,.1)] sm:grid-cols-4">
          <div className="flex min-h-[74px] items-start gap-2.5 border-b border-black/[0.06] p-3.5 sm:border-b-0 sm:border-r">
            <IconCalendar size={18} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Date</p><p className="mt-0.5 text-[13px] font-semibold text-gray-900">{formatEventDayDate(eventRow.date_start)}</p></div>
          </div>
          <div className="flex min-h-[74px] items-start gap-2.5 border-b border-black/[0.06] p-3.5 sm:border-b-0 sm:border-r">
            <IconClock size={18} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Heure</p><p className="mt-0.5 text-[13px] font-semibold text-gray-900">{formatEventTime(eventRow.date_start)}</p></div>
          </div>
          <div className="flex min-h-[74px] items-start gap-2.5 border-b border-black/[0.06] p-3.5 sm:border-b-0 sm:border-r">
            <IconMapPin size={18} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Lieu</p><p className="mt-0.5 line-clamp-2 text-[13px] font-semibold text-gray-900">{eventRow.location ?? 'À confirmer'}</p>{mapsHref && <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex min-h-7 items-center gap-1 text-[11px] font-bold text-[var(--color-primary)] underline-offset-2 hover:underline">Voir sur la carte <IconExternalLink size={12} /></a>}</div>
          </div>
          <div className="flex min-h-[74px] items-start gap-2.5 p-3.5">
            <IconUsers size={18} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Disponibilité</p>
              <p className={`mt-0.5 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${availabilityClasses(eventRow.capacity_remaining)}`}>{availabilityLabel(eventRow.capacity_remaining)}</p>
              {!soldOut && eventRow.capacity_remaining > 25 && <p className="mt-0.5 text-[9px] text-gray-400">{eventRow.capacity_remaining} places disponibles</p>}
            </div>
          </div>
        </section>

        {socialPhotos.length > 0 && (
          <div className="mt-4">
            <EventSocialShare
              eventSlug={eventRow.slug}
              eventTitle={eventRow.title}
              photos={socialPhotos.map((photo) => ({ id: photo.id, imageUrl: photo.image_url, caption: photo.caption }))}
            />
          </div>
        )}

        <div className="py-6 sm:py-7">
          <EventCheckoutClient
            event={{ id: eventRow.id, slug: eventRow.slug, title: eventRow.title, capacityRemaining: eventRow.capacity_remaining }}
            ticketTypes={ticketTypes}
            tenant={{ currency: tenant.currency }}
            soldOut={soldOut}
            featureRow={featureRow}
            externalPaymentMethods={externalPaymentMethods}
            isE2ETest={isE2ERequest()}
          />

          <div className="mb-24 mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-gray-500 sm:mb-0 sm:mt-5">
            <span className="flex items-center gap-2"><IconLock size={17} className="text-[var(--color-primary)]" />Paiement sécurisé</span>
            <span className="flex items-center gap-2"><IconCircleCheck size={17} className="text-[var(--color-primary)]" />Réservation confirmée après paiement</span>
          </div>
        </div>
      </main>
    </div>
  );
}
