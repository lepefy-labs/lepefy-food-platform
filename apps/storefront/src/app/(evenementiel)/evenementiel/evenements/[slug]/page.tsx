import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { IconFlame, IconCalendar, IconMapPin, IconUsers, IconLock, IconCircleCheck } from '@tabler/icons-react';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { formatEventDayDate, formatEventTime } from '@/lib/utils/format';
import { EventImageFader } from '@/components/evenementiel/EventImageFader';
import { getHighlightIcon } from '@/lib/events/highlightIcons';
import EventCheckoutClient from './EventCheckoutClient';
import type { EventRow, EventTicketType } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Identité fixe du module Événementiel (058) — un seul thème pour tous les
// tenants/événements, plus de fallback vers tenant.primary_color/secondary_color.
// La colonne theme_primary_color/theme_secondary_color reste l'override
// possible par événement (056) ; ce fallback ne joue que pour les événements
// créés avant la migration 058 (qui pose désormais un DEFAULT en base).
const EVENT_MODULE_DEFAULT_PRIMARY = '#E65C00';
const EVENT_MODULE_DEFAULT_SECONDARY = '#FFB347';

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

  // Même filtre que le checkout boutique (Phase 1, Décision 7) — n'importe
  // quelle ligne tenant_payment_methods dont le type n'est ni bank_transfer
  // ni cash et dont extra.link est renseigné devient une option de paiement.
  const allPaymentMethods = await getTenantPaymentMethods(tenant.id);
  const externalPaymentMethods = allPaymentMethods.filter(
    (m) => m.method !== 'bank_transfer' && m.method !== 'cash' && !!m.extra?.link,
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

  // Palette scoped à CET événement — plus de fallback tenant (058), identité
  // fixe du module. Portée volontairement limitée à ce root div (hero + contenu
  // + EventCheckoutClient) : EventsHeader/EventsFooter sont rendus par
  // (evenementiel)/layout.tsx, en dehors de l'arbre de ce fichier, donc hors
  // de portée de ce wrapper par construction — ils gardent toujours les
  // couleurs du tenant.
  const primaryColor   = eventRow.theme_primary_color   ?? EVENT_MODULE_DEFAULT_PRIMARY;
  const secondaryColor = eventRow.theme_secondary_color ?? EVENT_MODULE_DEFAULT_SECONDARY;
  const eventThemeStyle: CSSProperties = {
    '--color-primary': primaryColor,
    '--color-primary-dark': `color-mix(in srgb, ${primaryColor} 75%, black)`,
    '--color-secondary': secondaryColor,
  } as CSSProperties;

  const titleLines = eventRow.title.split('\n');
  const mapsHref = eventRow.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(eventRow.location)}`
    : null;

  const highlights = (eventRow.highlights ?? []).slice(0, 3);
  // Contenu propriété de page.tsx (données événement) mais rendu par
  // EventCheckoutClient entre les cards formule et le récapitulatif, pour
  // matcher l'ordre du mockup — EventCheckoutClient ne l'affiche que sur
  // l'étape 'select', jamais sur 'info'/'payment'.
  const featureRow = highlights.length > 0 && (
    <div
      className="rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:gap-4 flex-wrap"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, white)' }}
    >
      {highlights.map((highlight, i) => {
        const Icon = getHighlightIcon(highlight.icon);
        return (
          <div key={i} className="flex-1 sm:min-w-[150px] text-center">
            <Icon size={24} style={{ color: 'var(--color-primary)' }} className="mx-auto" stroke={1.8} />
            <p className="text-[13px] font-bold text-gray-900 mt-1.5 mb-0.5">{highlight.title}</p>
            <p className="text-[12.5px] text-gray-500 leading-snug">{highlight.text}</p>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f7f9f8]" style={eventThemeStyle}>
      <EventImageFader
        images={eventImages}
        fallbackColor="var(--color-primary)"
        className="min-h-[300px] rounded-b-[20px]"
      >
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(10,8,6,.35) 0%, rgba(10,8,6,.88) 100%)' }}
          aria-hidden="true"
        />
        <div className="relative max-w-2xl mx-auto px-5 sm:px-6 pt-6 pb-8 text-white">
          <div className="flex justify-end mb-2">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <IconFlame size={14} /> ÉVÉNEMENT
            </span>
          </div>

          <h1 className="font-display font-extrabold leading-[1.05] text-3xl sm:text-4xl">
            {titleLines.map((line, i) => (
              <span key={i} className="block" style={i === 0 ? undefined : { color: 'var(--color-secondary)' }}>
                {line}
              </span>
            ))}
          </h1>

          {eventRow.subtitle && (
            <p className="font-display italic font-medium text-lg sm:text-xl mt-0.5" style={{ color: 'var(--color-secondary)' }}>
              {eventRow.subtitle}
            </p>
          )}

          {eventRow.description && (
            <p className="text-sm leading-relaxed text-white/85 max-w-[480px] mt-3 whitespace-pre-line">
              {eventRow.description}
            </p>
          )}
        </div>
      </EventImageFader>

      <div className="max-w-2xl mx-auto px-4">
        <div className="relative z-[2] -mt-[30px] rounded-2xl bg-[#181310] text-white px-4 sm:px-5 py-4 flex flex-col sm:flex-row gap-4 sm:gap-6 flex-wrap text-[13px]">
          <div className="flex items-start gap-2.5">
            <IconCalendar size={19} style={{ color: 'var(--color-secondary)' }} className="mt-0.5 shrink-0" />
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[#a9a49d]">Date</div>
              <div>{formatEventDayDate(eventRow.date_start)}</div>
              <div>{formatEventTime(eventRow.date_start)}</div>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <IconMapPin size={19} style={{ color: 'var(--color-secondary)' }} className="mt-0.5 shrink-0" />
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[#a9a49d]">Lieu</div>
              {eventRow.location ? (
                <>
                  <div>{eventRow.location}</div>
                  <a
                    href={mapsHref ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline"
                    style={{ color: 'var(--color-secondary)' }}
                  >
                    Voir sur la carte
                  </a>
                </>
              ) : (
                <div className="text-[#a9a49d]">-</div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <IconUsers size={19} style={{ color: 'var(--color-secondary)' }} className="mt-0.5 shrink-0" />
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[#a9a49d]">Places</div>
              <div className={`font-semibold ${soldOut ? 'text-red-400' : ''}`} style={soldOut ? undefined : { color: '#7ee08a' }}>
                {soldOut ? 'Complet' : `${eventRow.capacity_remaining} disponible${eventRow.capacity_remaining > 1 ? 's' : ''}`}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <EventCheckoutClient
          event={{ id: eventRow.id, slug: eventRow.slug, title: eventRow.title, capacityRemaining: eventRow.capacity_remaining }}
          ticketTypes={ticketTypes}
          tenant={{ currency: tenant.currency }}
          soldOut={soldOut}
          featureRow={featureRow}
          externalPaymentMethods={externalPaymentMethods}
        />

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-5">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <IconLock size={18} style={{ color: 'var(--color-primary)' }} />
            Paiement 100% sécurisé · Stripe &amp; Carte
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <IconCircleCheck size={18} style={{ color: 'var(--color-primary)' }} />
            Réservation confirmée · Places garanties
          </div>
        </div>
      </div>
    </div>
  );
}
