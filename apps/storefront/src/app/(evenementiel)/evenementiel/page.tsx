import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  IconArrowRight,
  IconCalendarEvent,
  IconChefHat,
  IconClock,
  IconMapPin,
  IconTools,
  IconUsers,
} from '@tabler/icons-react';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { getHeroContext, MAX_HERO_IMAGES, selectHeroMedia } from '@/lib/events/selectHeroMedia';
import { loadHeroGallery } from '@/lib/events/loadHeroGallery';
import { formatEventDayDate, formatEventTime, formatPrice } from '@/lib/utils/format';
import { EventImageFader } from '@/components/evenementiel/EventImageFader';
import EventSocialShareButton, { type EventSocialPhoto } from '@/components/evenementiel/EventSocialShareButton';
import { EventHeroAccent } from '../_components/EventHeroAccent';
import type { EventRow, ServiceOffering, EventGalleryPhoto } from '@lepefy/types';

type EventPhotoRef = EventGalleryPhoto;
type EventPriceRef = { event_id: string; price: number };
type BookingUrgency = { label: string; className: string; closed: boolean };

export const revalidate = 120;

function availabilityClasses(remaining: number) {
  if (remaining <= 10) return 'border-red-200 bg-red-50 text-red-700';
  if (remaining <= 25) return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function availabilityLabel(remaining: number, showExact: boolean) {
  if (remaining <= 0) return 'Complet';
  if (!showExact) {
    if (remaining <= 10) return 'Presque complet';
    if (remaining <= 25) return 'Places limitées';
    return 'Places disponibles';
  }
  if (remaining <= 25) return `Plus que ${remaining} place${remaining > 1 ? 's' : ''}`;
  return 'Encore beaucoup de places';
}

function availabilityDetail(remaining: number, showExact: boolean) {
  if (!showExact || remaining <= 0 || remaining <= 25) return null;
  return `${remaining} places disponibles`;
}

function bookingUrgency(event: EventRow): BookingUrgency | null {
  if (!event.booking_closes_at) return null;
  const deadline = new Date(event.booking_closes_at).getTime();
  if (Number.isNaN(deadline)) return null;

  const remainingMs = deadline - Date.now();
  const showExact = event.show_remaining_places !== false;
  const scarcePlaces = showExact && event.capacity_remaining > 0 && event.capacity_remaining <= 10
    ? ` · ${event.capacity_remaining} place${event.capacity_remaining > 1 ? 's' : ''} restante${event.capacity_remaining > 1 ? 's' : ''}`
    : '';

  if (remainingMs <= 0) return { label: 'Réservations clôturées', className: 'border-gray-300 bg-gray-100 text-gray-700', closed: true };

  const hoursRemaining = remainingMs / 3_600_000;
  if (hoursRemaining <= 2) return { label: `Moins de 2 h pour réserver${scarcePlaces}`, className: 'border-red-200 bg-red-50 text-red-800', closed: false };
  if (hoursRemaining <= 6) return { label: `Dernières heures pour réserver${scarcePlaces}`, className: 'border-orange-200 bg-orange-50 text-orange-900', closed: false };
  if (hoursRemaining <= 24) return { label: `Plus que ${Math.ceil(hoursRemaining)} h pour réserver${scarcePlaces}`, className: 'border-amber-200 bg-amber-50 text-amber-900', closed: false };
  return null;
}

export async function generateMetadata(): Promise<Metadata> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  return { title: 'Événementiel', description: `Événements, traiteur et location de matériel — ${tenant.name}.` };
}

export default async function EvenementielHubPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  if (!tenant.events_enabled && !tenant.services_enabled) notFound();

  const supabase = createPublicClient();
  const now = new Date();
  const [eventsRes, servicesRes, galleryRes] = await Promise.all([
    tenant.events_enabled
      ? supabase.from('events').select('*').eq('tenant_id', tenant.id).eq('status', 'published').gte('date_start', now.toISOString()).order('date_start', { ascending: true }).order('id', { ascending: true })
      : Promise.resolve({ data: [] as EventRow[] }),
    tenant.services_enabled
      ? supabase.from('service_offerings').select('*').eq('tenant_id', tenant.id).eq('active', true).order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] as ServiceOffering[] }),
    tenant.events_enabled || tenant.services_enabled
      ? supabase.from('event_gallery_photos').select('*').eq('tenant_id', tenant.id).order('sort_order', { ascending: true }).limit(10)
      : Promise.resolve({ data: [] as EventGalleryPhoto[] }),
  ]);

  const events = (eventsRes.data ?? []) as EventRow[];
  const services = (servicesRes.data ?? []) as ServiceOffering[];
  const gallery = (galleryRes.data ?? []) as EventGalleryPhoto[];
  const { context: heroContext, nextEvent, imminentEvent } = getHeroContext(events, now);
  const eventIds = events.map((event) => event.id);
  const heroCategories: EventGalleryPhoto['category'][] = heroContext === 'imminent_event'
    ? ['ambiance', 'general']
    : ['event', 'traiteur', 'location_materiel', 'ambiance', 'general'];
  const [eventPhotosRes, editorialPhotos] = await Promise.all([
    eventIds.length
      ? supabase.from('event_gallery_photos').select('*').eq('tenant_id', tenant.id)
          .in('event_id', eventIds).order('sort_order', { ascending: true }).order('id', { ascending: true })
      : Promise.resolve({ data: [] as EventPhotoRef[] }),
    loadHeroGallery(supabase, tenant.id, heroCategories),
  ]);
  const photosByEvent = new Map<string, string[]>();
  const socialPhotosByEvent = new Map<string, EventSocialPhoto[]>();

  for (const photo of (eventPhotosRes.data ?? []) as EventPhotoRef[]) {
    if (!photo.event_id) continue;
    const list = photosByEvent.get(photo.event_id) ?? [];
    list.push(photo.image_url);
    photosByEvent.set(photo.event_id, list);
    if (Boolean(photo.is_social_share)) {
      const socialList = socialPhotosByEvent.get(photo.event_id) ?? [];
      socialList.push({ id: photo.id, imageUrl: photo.image_url, caption: photo.caption });
      socialPhotosByEvent.set(photo.event_id, socialList);
    }
  }

  const ticketPricesRes = eventIds.length > 0
    ? await supabase.from('event_ticket_types').select('event_id, price').in('event_id', eventIds).eq('active', true)
    : { data: [] as EventPriceRef[] };
  const minPriceByEvent = new Map<string, number>();
  for (const ticket of (ticketPricesRes.data ?? []) as EventPriceRef[]) {
    const current = minPriceByEvent.get(ticket.event_id);
    if (current == null || ticket.price < current) minPriceByEvent.set(ticket.event_id, ticket.price);
  }

  const featuredEvent = nextEvent;
  const secondaryEvents = events.filter((event) => event.id !== featuredEvent?.id);
  const featuredUrgency = featuredEvent ? bookingUrgency(featuredEvent) : null;
  const heroImages = selectHeroMedia({
    events,
    photos: [...editorialPhotos, ...((eventPhotosRes.data ?? []) as EventPhotoRef[])],
    services,
    now,
  });
  const traiteur = services.find((service) => service.type === 'traiteur') ?? services.find((service) => service.cta_type === 'devis') ?? null;
  const location = services.find((service) => service.type === 'location_materiel') ?? services.find((service) => service.cta_type === 'reservation') ?? null;
  const whatsappHref = tenant.whatsapp_number ? `https://wa.me/${tenant.whatsapp_number.replace(/\D/g, '')}` : null;
  const contactHref = whatsappHref ?? (tenant.legal_email ? `mailto:${tenant.legal_email}` : '/#contact');
  const heroPrimaryHref = imminentEvent ? `/evenements/${imminentEvent.slug}`
    : heroContext === 'upcoming_event' ? '#evenements'
    : services.length ? '#services' : contactHref;
  const heroPrimaryLabel = imminentEvent ? 'Découvrir l’événement'
    : heroContext === 'upcoming_event' ? 'Découvrir les événements'
    : services.length ? 'Découvrir nos services' : 'Parlons de votre projet';
  const heroSecondaryHref = heroContext === 'no_events'
    ? traiteur ? `/services/${traiteur.slug}` : location ? `/services/${location.slug}` : contactHref
    : services.length ? '#services' : contactHref;
  const heroSecondaryLabel = heroContext === 'no_events'
    ? traiteur ? 'Découvrir le traiteur' : location ? 'Découvrir la location' : 'Nous contacter'
    : services.length ? 'Nos services' : 'Nous contacter';
  const serviceLabels = [traiteur ? 'Traiteur' : null, location ? 'location de matériel' : null].filter(Boolean).join(', ');



  return (
    <div className="min-h-screen bg-[#f7f3eb] text-[#20231f]">
      <section className="relative isolate min-h-[560px] overflow-hidden sm:min-h-[620px] lg:min-h-[650px]">
        <EventImageFader images={heroImages} fallbackColor="var(--color-primary-dark)" className="absolute inset-0 h-full w-full">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(26,18,104,.94)_0%,rgba(38,24,132,.80)_42%,rgba(23,17,82,.32)_72%,rgba(17,12,58,.58)_100%)]" aria-hidden="true" />
        </EventImageFader>
        <div className="absolute right-[-28px] top-1/2 z-[2] hidden -translate-y-1/2 gap-4 lg:flex" aria-hidden="true">
          {[0, 1, 2].map((item) => <span key={item} className="block h-28 w-7 -skew-x-[28deg] rounded-sm bg-[var(--color-secondary)]/85" />)}
        </div>
        <div className="relative z-[3] mx-auto flex min-h-[560px] max-w-[1180px] items-end px-4 pb-10 pt-16 sm:min-h-[620px] sm:px-6 sm:pb-14 lg:min-h-[650px] lg:items-center lg:pb-10">
          <div className="max-w-[730px] text-white">
            <p className="text-2xl font-bold leading-[1.05] sm:text-3xl lg:text-[2.55rem]">Nous créons<br />des événements</p>
            <h1 className="mt-2 font-display text-[3.55rem] font-black uppercase leading-[.9] tracking-[-.045em] sm:text-[5rem] lg:text-[6.5rem]"><EventHeroAccent /></h1>
            <p className="mt-5 max-w-[620px] text-base leading-relaxed text-white/88 sm:text-lg">{heroContext === 'no_events'
              ? serviceLabels ? `${serviceLabels} et expériences pour organiser vos réceptions avec style et simplicité.` : 'Des expériences et des événements conçus pour rassembler vos invités avec style et simplicité.'
              : 'Événements, traiteur et expériences conçus pour rassembler vos invités avec style et simplicité.'}</p>
            {imminentEvent && featuredEvent && (
              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-white/80">
                <span className="inline-flex items-center gap-1.5"><IconCalendarEvent size={16} />{formatEventDayDate(featuredEvent.date_start)}</span>
                <span className="inline-flex items-center gap-1.5"><IconClock size={16} />{formatEventTime(featuredEvent.date_start)}</span>
                {featuredEvent.location && <span className="inline-flex items-center gap-1.5"><IconMapPin size={16} />{featuredEvent.location}</span>}
              </div>
            )}
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href={heroPrimaryHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--color-secondary)] px-6 text-sm font-extrabold text-[var(--color-primary-dark)] shadow-lg transition-transform hover:-translate-y-0.5">
                {heroPrimaryLabel} <IconArrowRight size={18} />
              </Link>
              <a href={heroSecondaryHref} className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/70 bg-white/5 px-6 text-sm font-bold text-white backdrop-blur-sm hover:bg-white/10">{heroSecondaryLabel}</a>
            </div>
          </div>
        </div>
      </section>

      <nav className="border-b border-black/[.06] bg-white" aria-label="Accès rapides événementiel">
        <div className="mx-auto grid max-w-[900px] grid-cols-3 divide-x divide-black/[.07] px-2 py-3 sm:py-4">
          <a href="#evenements" className="flex min-h-14 flex-col items-center justify-center gap-1 text-center text-[11px] font-extrabold uppercase tracking-[.04em] text-[var(--color-primary-dark)] sm:text-xs"><IconCalendarEvent size={22} />Événements</a>
          <a href={traiteur ? `/services/${traiteur.slug}` : '#services'} className="flex min-h-14 flex-col items-center justify-center gap-1 text-center text-[11px] font-extrabold uppercase tracking-[.04em] text-[var(--color-primary-dark)] sm:text-xs"><IconChefHat size={22} />Traiteur</a>
          <a href={location ? `/services/${location.slug}` : '#services'} className="flex min-h-14 flex-col items-center justify-center gap-1 text-center text-[11px] font-extrabold uppercase tracking-[.04em] text-[var(--color-primary-dark)] sm:text-xs"><IconTools size={22} />Location</a>
        </div>
      </nav>

      <main className="mx-auto max-w-[1180px] px-4 sm:px-6">
        {tenant.services_enabled && services.length > 0 && (
          <section id="services" className="scroll-mt-24 py-10 sm:py-12">
            <div className="mx-auto mb-8 max-w-[760px] text-center">
              <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[var(--color-primary)]">Nos solutions</p>
              <h2 className="mt-2 font-display text-3xl font-semibold leading-tight text-[var(--color-primary-dark)] sm:text-4xl">Pour vos événements, nous avons <span className="text-[var(--color-secondary)]">des solutions.</span></h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {traiteur && (
                <Link id="traiteur" href={`/services/${traiteur.slug}`} className="group relative min-h-[310px] overflow-hidden rounded-[28px] bg-[var(--color-primary-dark)] text-white shadow-lg">
                  {traiteur.cover_image_url && <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03]" style={{ backgroundImage: `url(${traiteur.cover_image_url})` }} />}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/50 to-black/20" />
                  <div className="relative flex h-full min-h-[310px] max-w-md flex-col justify-end p-6 sm:p-8">
                    <IconChefHat size={30} className="mb-4 text-[var(--color-secondary)]" />
                    <h3 className="font-display text-3xl font-semibold">Traiteur</h3>
                    {traiteur.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/75">{traiteur.description}</p>}
                    <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--color-secondary)]">Découvrir <IconArrowRight size={16} /></span>
                  </div>
                </Link>
              )}
              {location && (
                <Link id="location" href={`/services/${location.slug}`} className="group relative min-h-[310px] overflow-hidden rounded-[28px] bg-[#e9dcc1] text-[#1f281f] shadow-lg">
                  {location.cover_image_url && <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03]" style={{ backgroundImage: `url(${location.cover_image_url})` }} />}
                  <div className="absolute inset-0 bg-gradient-to-r from-[#f3e8d1]/95 via-[#f3e8d1]/78 to-[#f3e8d1]/25" />
                  <div className="relative flex h-full min-h-[310px] max-w-md flex-col justify-end p-6 sm:p-8">
                    <IconTools size={30} className="mb-4 text-[var(--color-primary)]" />
                    <h3 className="font-display text-3xl font-semibold">Location de matériel</h3>
                    {location.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#374139]">{location.description}</p>}
                    <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--color-primary-dark)]">Découvrir <IconArrowRight size={16} /></span>
                  </div>
                </Link>
              )}
            </div>
          </section>
        )}

        {tenant.events_enabled && (
          <section id="evenements" className="scroll-mt-24 py-10 sm:py-12">
            <div className="mb-7 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">Prochain rendez-vous</p>
                <h2 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">À venir chez {tenant.name}</h2>
              </div>
              {events.length > 1 && <span className="hidden text-sm text-gray-500 sm:inline">{events.length} événements programmés</span>}
            </div>

            {featuredEvent ? (
              <div className="space-y-5">
                <div className="relative">
                  <Link href={`/evenements/${featuredEvent.slug}`} className="group grid overflow-hidden rounded-[28px] border border-black/[0.06] bg-white shadow-[0_18px_45px_rgba(50,37,20,.08)] md:grid-cols-[1.15fr_.85fr]">
                    <EventImageFader images={(photosByEvent.get(featuredEvent.id) ?? (featuredEvent.banner_image_url ? [featuredEvent.banner_image_url] : [])).slice(0, MAX_HERO_IMAGES)} fallbackColor="var(--color-primary-light)" className="min-h-[250px] md:min-h-[330px]">
                      <span className="absolute left-4 top-4 rounded-full bg-[var(--color-secondary)] px-3 py-1.5 text-[11px] font-extrabold tracking-wide text-[var(--color-primary-dark)]">À LA UNE</span>
                    </EventImageFader>
                    <div className="flex flex-col justify-between p-5 sm:p-6 md:p-7">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">Prochain événement</p>
                          {featuredUrgency && <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${featuredUrgency.className}`}><IconClock size={13} /> {featuredUrgency.label}</span>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">{featuredEvent.title}</h3>
                            {featuredEvent.subtitle && <p className="mt-1.5 text-sm text-gray-600">{featuredEvent.subtitle}</p>}
                          </div>
                          {minPriceByEvent.has(featuredEvent.id) && (
                            <div className="shrink-0 text-right">
                              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">À partir de</p>
                              <p className="mt-0.5 font-display text-2xl font-semibold text-gray-900">{formatPrice(minPriceByEvent.get(featuredEvent.id)!, tenant.currency)}</p>
                            </div>
                          )}
                        </div>
                        <div className="mt-5 grid gap-2.5 text-sm text-gray-650 sm:grid-cols-2">
                          <p className="flex items-center gap-2"><IconCalendarEvent size={18} className="text-[var(--color-primary)]" />{formatEventDayDate(featuredEvent.date_start)}</p>
                          <p className="flex items-center gap-2"><IconClock size={18} className="text-[var(--color-primary)]" />{formatEventTime(featuredEvent.date_start)}</p>
                          {featuredEvent.location && <p className="flex items-center gap-2 sm:col-span-2"><IconMapPin size={18} className="shrink-0 text-[var(--color-primary)]" /><span className="line-clamp-1">{featuredEvent.location}</span></p>}
                          {!featuredUrgency?.closed && (
                            <div className="sm:col-span-2">
                              <p className={`flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 font-bold ${availabilityClasses(featuredEvent.capacity_remaining)}`}><IconUsers size={17} /> {availabilityLabel(featuredEvent.capacity_remaining, featuredEvent.show_remaining_places !== false)}</p>
                              {availabilityDetail(featuredEvent.capacity_remaining, featuredEvent.show_remaining_places !== false) && <p className="mt-1.5 pl-1 text-xs text-gray-400">{availabilityDetail(featuredEvent.capacity_remaining, featuredEvent.show_remaining_places !== false)}</p>}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-5 flex items-center justify-end border-t border-black/[0.06] pt-4">
                        <span className="inline-flex min-h-11 items-center gap-1.5 rounded-[12px] bg-[var(--color-primary)] px-5 text-sm font-bold text-white transition-colors group-hover:bg-[var(--color-primary-dark)]">{featuredUrgency?.closed ? 'Voir l’événement' : 'Voir & réserver'} <IconArrowRight size={16} /></span>
                      </div>
                    </div>
                  </Link>
                  {(socialPhotosByEvent.get(featuredEvent.id)?.length ?? 0) > 0 && <EventSocialShareButton eventSlug={featuredEvent.slug} eventTitle={featuredEvent.title} photos={socialPhotosByEvent.get(featuredEvent.id)!} className="absolute right-4 top-4" />}
                </div>

                {secondaryEvents.length > 0 && (
                  <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
                    {secondaryEvents.map((event) => {
                      const urgency = bookingUrgency(event);
                      const showRemainingPlaces = event.show_remaining_places !== false;
                      return (
                        <div key={event.id} className="relative min-w-[78vw] snap-start sm:min-w-0">
                          <Link href={`/evenements/${event.slug}`} className="group block h-full overflow-hidden rounded-3xl border border-black/[0.06] bg-white shadow-sm">
                            <EventImageFader images={(photosByEvent.get(event.id) ?? (event.banner_image_url ? [event.banner_image_url] : [])).slice(0, MAX_HERO_IMAGES)} fallbackColor="var(--color-primary-light)" className="aspect-[16/10]">
                              {urgency && <span className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-extrabold shadow-sm ${urgency.className}`}><IconClock size={12} /> {urgency.label}</span>}
                            </EventImageFader>
                            <div className="p-4">
                              <div className="flex items-start justify-between gap-3">
                                <h3 className="font-display text-xl font-semibold">{event.title}</h3>
                                {minPriceByEvent.has(event.id) && <span className="shrink-0 text-sm font-bold text-gray-900">{formatPrice(minPriceByEvent.get(event.id)!, tenant.currency)}</span>}
                              </div>
                              <div className="mt-3 space-y-1.5 text-xs text-gray-500">
                                <p className="flex items-center gap-1.5"><IconCalendarEvent size={14} />{formatEventDayDate(event.date_start)}</p>
                                {event.location && <p className="flex items-center gap-1.5"><IconMapPin size={14} /><span className="line-clamp-1">{event.location}</span></p>}
                              </div>
                              <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                                {!urgency?.closed && (
                                  <div>
                                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${availabilityClasses(event.capacity_remaining)}`}><IconUsers size={13} /> {availabilityLabel(event.capacity_remaining, showRemainingPlaces)}</span>
                                    {availabilityDetail(event.capacity_remaining, showRemainingPlaces) && <p className="mt-1 pl-1 text-[10px] text-gray-400">{availabilityDetail(event.capacity_remaining, showRemainingPlaces)}</p>}
                                  </div>
                                )}
                                <span className="inline-flex items-center gap-1 text-sm font-bold text-[var(--color-primary)]">{urgency?.closed ? 'Voir l’événement' : 'Voir & réserver'} <IconArrowRight size={15} /></span>
                              </div>
                            </div>
                          </Link>
                          {(socialPhotosByEvent.get(event.id)?.length ?? 0) > 0 && <EventSocialShareButton eventSlug={event.slug} eventTitle={event.title} photos={socialPhotosByEvent.get(event.id)!} className="absolute right-3 top-3" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-3xl border border-black/[0.06] bg-white p-8 text-center text-sm text-gray-500">Aucun événement à venir pour le moment.</div>
            )}
          </section>
        )}

        {gallery.length > 0 && (
          <section id="galerie" className="scroll-mt-24 pb-16 sm:pb-20">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">Inspiration</p>
                <h2 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">Ambiances &amp; inspirations</h2>
              </div>
              <span className="hidden text-sm text-gray-500 sm:inline">Un aperçu de nos univers</span>
            </div>
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0">
              {gallery.map((photo, index) => (
                <figure key={photo.id} className={`relative min-w-[68vw] snap-start overflow-hidden rounded-2xl bg-gray-100 sm:min-w-0 ${index % 5 === 0 ? 'sm:col-span-2 sm:row-span-2' : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.image_url} alt={photo.caption ?? ''} className="aspect-[4/3] h-full min-h-[210px] w-full object-cover sm:aspect-auto" />
                  {photo.caption && <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-10 text-xs text-white">{photo.caption}</figcaption>}
                </figure>
              ))}
            </div>
            <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-3xl border border-black/[0.06] bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:p-6">
              <div>
                <p className="font-display text-2xl font-semibold">Vous imaginez votre événement ici ?</p>
                <p className="mt-1 text-sm text-gray-500">Parlons de votre projet et construisons une formule adaptée.</p>
              </div>
              {traiteur ? (
                <Link href={`/services/${traiteur.slug}`} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-bold text-white">Demander un devis <IconArrowRight size={16} /></Link>
              ) : (
                <a href="#contact" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-bold text-white">Nous contacter <IconArrowRight size={16} /></a>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
