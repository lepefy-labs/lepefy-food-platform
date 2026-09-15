import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { IconArrowRight, IconCalendarEvent, IconChefHat, IconClock, IconMapPin, IconTools, IconUsers } from '@tabler/icons-react';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatEventDayDate, formatEventTime, formatPrice } from '@/lib/utils/format';
import { EventImageFader } from '@/components/evenementiel/EventImageFader';
import EventSocialShareButton, { type EventSocialPhoto } from '@/components/evenementiel/EventSocialShareButton';
import { EventHeroAccent } from '../_components/EventHeroAccent';
import type { EventRow, ServiceOffering, EventGalleryPhoto } from '@lepefy/types';

type EventPhotoRef = Pick<EventGalleryPhoto, 'id' | 'event_id' | 'image_url' | 'caption'> & { is_social_share?: boolean };
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
  if (!showExact) return remaining <= 10 ? 'Presque complet' : remaining <= 25 ? 'Places limitées' : 'Places disponibles';
  if (remaining <= 25) return `Plus que ${remaining} place${remaining > 1 ? 's' : ''}`;
  return 'Encore beaucoup de places';
}

function bookingUrgency(event: EventRow): BookingUrgency | null {
  if (!event.booking_closes_at) return null;
  const deadline = new Date(event.booking_closes_at).getTime();
  if (Number.isNaN(deadline)) return null;
  const hoursRemaining = (deadline - Date.now()) / 3_600_000;
  if (hoursRemaining <= 0) return { label: 'Réservations clôturées', className: 'border-gray-300 bg-gray-100 text-gray-700', closed: true };
  if (hoursRemaining <= 2) return { label: 'Moins de 2 h pour réserver', className: 'border-red-200 bg-red-50 text-red-800', closed: false };
  if (hoursRemaining <= 6) return { label: 'Dernières heures pour réserver', className: 'border-orange-200 bg-orange-50 text-orange-900', closed: false };
  if (hoursRemaining <= 24) return { label: `Plus que ${Math.ceil(hoursRemaining)} h pour réserver`, className: 'border-amber-200 bg-amber-50 text-amber-900', closed: false };
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
  const [eventsRes, servicesRes, galleryRes, eventPhotosRes] = await Promise.all([
    tenant.events_enabled ? supabase.from('events').select('*').eq('tenant_id', tenant.id).eq('status', 'published').gte('date_start', new Date().toISOString()).order('date_start', { ascending: true }) : Promise.resolve({ data: [] as EventRow[] }),
    tenant.services_enabled ? supabase.from('service_offerings').select('*').eq('tenant_id', tenant.id).eq('active', true).order('sort_order', { ascending: true }) : Promise.resolve({ data: [] as ServiceOffering[] }),
    tenant.events_enabled ? supabase.from('event_gallery_photos').select('*').eq('tenant_id', tenant.id).order('sort_order', { ascending: true }).limit(10) : Promise.resolve({ data: [] as EventGalleryPhoto[] }),
    tenant.events_enabled ? supabase.from('event_gallery_photos').select('*').eq('tenant_id', tenant.id).not('event_id', 'is', null).order('sort_order', { ascending: true }) : Promise.resolve({ data: [] as EventPhotoRef[] }),
  ]);

  const events = (eventsRes.data ?? []) as EventRow[];
  const services = (servicesRes.data ?? []) as ServiceOffering[];
  const gallery = (galleryRes.data ?? []) as EventGalleryPhoto[];
  const photosByEvent = new Map<string, string[]>();
  const socialPhotosByEvent = new Map<string, EventSocialPhoto[]>();

  for (const photo of (eventPhotosRes.data ?? []) as EventPhotoRef[]) {
    if (!photo.event_id) continue;
    const list = photosByEvent.get(photo.event_id) ?? [];
    list.push(photo.image_url);
    photosByEvent.set(photo.event_id, list);
    if (Boolean(photo.is_social_share)) {
      const social = socialPhotosByEvent.get(photo.event_id) ?? [];
      social.push({ id: photo.id, imageUrl: photo.image_url, caption: photo.caption });
      socialPhotosByEvent.set(photo.event_id, social);
    }
  }

  const eventIds = events.map((event) => event.id);
  const ticketPricesRes = eventIds.length > 0 ? await supabase.from('event_ticket_types').select('event_id, price').in('event_id', eventIds).eq('active', true) : { data: [] as EventPriceRef[] };
  const minPriceByEvent = new Map<string, number>();
  for (const ticket of (ticketPricesRes.data ?? []) as EventPriceRef[]) {
    const current = minPriceByEvent.get(ticket.event_id);
    if (current == null || ticket.price < current) minPriceByEvent.set(ticket.event_id, ticket.price);
  }

  const featuredEvent = events[0] ?? null;
  const featuredUrgency = featuredEvent ? bookingUrgency(featuredEvent) : null;
  const heroImages = featuredEvent ? (photosByEvent.get(featuredEvent.id) ?? (featuredEvent.banner_image_url ? [featuredEvent.banner_image_url] : [])) : gallery.slice(0, 4).map((photo) => photo.image_url);
  const traiteur = services.find((service) => service.type === 'traiteur') ?? services.find((service) => service.cta_type === 'devis') ?? null;
  const location = services.find((service) => service.type === 'location_materiel') ?? services.find((service) => service.cta_type === 'reservation') ?? null;
  const featuredHref = featuredEvent ? `/evenements/${featuredEvent.slug}` : '#evenements';

  const solutions = [
    tenant.events_enabled ? { href: '#evenements', title: 'Événements', description: 'Soirées, rencontres et expériences à réserver.', image: featuredEvent?.banner_image_url ?? heroImages[0], icon: <IconCalendarEvent size={24} /> } : null,
    traiteur ? { href: `/services/${traiteur.slug}`, title: 'Traiteur', description: traiteur.description ?? 'Une cuisine généreuse pour tous vos événements.', image: traiteur.cover_image_url, icon: <IconChefHat size={24} /> } : null,
    location ? { href: `/services/${location.slug}`, title: 'Location de matériel', description: location.description ?? 'Mobilier et matériel pour recevoir simplement.', image: location.cover_image_url, icon: <IconTools size={24} /> } : null,
  ].filter(Boolean) as Array<{ href: string; title: string; description: string; image: string | null | undefined; icon: React.ReactNode }>;

  return (
    <div className="min-h-screen bg-white text-[#17162c]">
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
            <h1 className="mt-2 font-display text-[3.55rem] font-black uppercase leading-[.9] tracking-[-.045em] sm:text-[5rem] lg:text-[6.5rem]">
              <EventHeroAccent />
            </h1>
            <p className="mt-5 max-w-[620px] text-base leading-relaxed text-white/88 sm:text-lg">Événements, traiteur et expériences conçus pour rassembler vos invités avec style et simplicité.</p>

            {featuredEvent && (
              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-white/80">
                <span className="inline-flex items-center gap-1.5"><IconCalendarEvent size={16} />{formatEventDayDate(featuredEvent.date_start)}</span>
                <span className="inline-flex items-center gap-1.5"><IconClock size={16} />{formatEventTime(featuredEvent.date_start)}</span>
                {featuredEvent.location && <span className="inline-flex items-center gap-1.5"><IconMapPin size={16} />{featuredEvent.location}</span>}
              </div>
            )}

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link href={featuredHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--color-secondary)] px-6 text-sm font-extrabold text-[var(--color-primary-dark)] shadow-lg transition-transform hover:-translate-y-0.5">
                {featuredEvent ? 'Découvrir les événements' : 'Voir les événements'} <IconArrowRight size={18} />
              </Link>
              <a href="#services" className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/70 bg-white/5 px-6 text-sm font-bold text-white backdrop-blur-sm hover:bg-white/10">Organiser un événement</a>
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

      <main>
        {solutions.length > 0 && (
          <section id="services" className="mx-auto max-w-[1180px] scroll-mt-24 px-4 py-12 sm:px-6 sm:py-16">
            <div className="mx-auto mb-8 max-w-[760px] text-center">
              <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[var(--color-primary)]">Nos solutions</p>
              <h2 className="mt-2 font-display text-3xl font-bold leading-tight text-[var(--color-primary-dark)] sm:text-4xl">Pour vos événements, nous avons <span className="text-[var(--color-secondary)]">des solutions.</span></h2>
            </div>
            <div className={`grid gap-4 ${solutions.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
              {solutions.map((solution) => (
                <Link id={solution.title === 'Traiteur' ? 'traiteur' : solution.title.startsWith('Location') ? 'location' : undefined} key={solution.title} href={solution.href} className="group relative min-h-[235px] overflow-hidden rounded-[26px] bg-[var(--color-primary-dark)] text-white shadow-[0_16px_42px_rgba(27,21,81,.16)]">
                  {solution.image && <div className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.04]" style={{ backgroundImage: `url(${solution.image})` }} />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/5" />
                  <div className="relative flex min-h-[235px] flex-col justify-end p-5 sm:p-6">
                    <span className="mb-3 text-[var(--color-secondary)]">{solution.icon}</span>
                    <h3 className="font-display text-2xl font-bold">{solution.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-white/80">{solution.description}</p>
                    <span className="absolute bottom-5 right-5 flex size-10 items-center justify-center rounded-full bg-white text-[var(--color-primary-dark)] transition-transform group-hover:translate-x-1"><IconArrowRight size={18} /></span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {tenant.events_enabled && (
          <section id="evenements" className="scroll-mt-24 bg-[#f7f7fb] py-12 sm:py-16">
            <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
              <div className="mb-8 flex items-end justify-between gap-4">
                <div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-[var(--color-primary)]">À venir</p><h2 className="mt-1 font-display text-3xl font-bold sm:text-4xl">Les prochains rendez-vous</h2></div>
                {events.length > 1 && <span className="hidden text-sm text-gray-500 sm:inline">{events.length} événements programmés</span>}
              </div>

              {events.length > 0 ? (
                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {events.map((event, index) => {
                    const urgency = bookingUrgency(event);
                    const showRemainingPlaces = event.show_remaining_places !== false;
                    const price = minPriceByEvent.get(event.id);
                    return (
                      <div key={event.id} className={`relative ${index === 0 ? 'md:col-span-2 lg:col-span-1' : ''}`}>
                        <Link href={`/evenements/${event.slug}`} className="group block h-full overflow-hidden rounded-[26px] border border-black/[.06] bg-white shadow-sm">
                          <EventImageFader images={photosByEvent.get(event.id) ?? (event.banner_image_url ? [event.banner_image_url] : [])} fallbackColor="var(--color-primary-light)" className="aspect-[16/10]">
                            {index === 0 && <span className="absolute left-3 top-3 rounded-full bg-[var(--color-secondary)] px-3 py-1 text-[10px] font-extrabold uppercase text-[var(--color-primary-dark)]">À la une</span>}
                          </EventImageFader>
                          <div className="p-5">
                            <div className="flex items-start justify-between gap-3"><h3 className="font-display text-2xl font-bold leading-tight">{event.title}</h3>{price != null && <span className="shrink-0 text-sm font-extrabold">{formatPrice(price, tenant.currency)}</span>}</div>
                            {event.subtitle && <p className="mt-2 line-clamp-2 text-sm text-gray-600">{event.subtitle}</p>}
                            <div className="mt-4 space-y-2 text-sm text-gray-600">
                              <p className="flex items-center gap-2"><IconCalendarEvent size={17} className="text-[var(--color-primary)]" />{formatEventDayDate(event.date_start)}</p>
                              <p className="flex items-center gap-2"><IconClock size={17} className="text-[var(--color-primary)]" />{formatEventTime(event.date_start)}</p>
                              {event.location && <p className="flex items-center gap-2"><IconMapPin size={17} className="text-[var(--color-primary)]" /><span className="line-clamp-1">{event.location}</span></p>}
                            </div>
                            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-black/[.06] pt-4">
                              {!urgency?.closed && <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${availabilityClasses(event.capacity_remaining)}`}><IconUsers size={14} />{availabilityLabel(event.capacity_remaining, showRemainingPlaces)}</span>}
                              {urgency && <span className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${urgency.className}`}>{urgency.label}</span>}
                              <span className="ml-auto inline-flex items-center gap-1 text-sm font-extrabold text-[var(--color-primary)]">Voir & réserver <IconArrowRight size={16} /></span>
                            </div>
                          </div>
                        </Link>
                        {(socialPhotosByEvent.get(event.id)?.length ?? 0) > 0 && <EventSocialShareButton eventSlug={event.slug} eventTitle={event.title} photos={socialPhotosByEvent.get(event.id)!} className="absolute right-3 top-3" />}
                      </div>
                    );
                  })}
                </div>
              ) : <div className="rounded-3xl border border-black/[.06] bg-white p-8 text-center text-sm text-gray-500">Aucun événement à venir pour le moment.</div>}
            </div>
          </section>
        )}

        {gallery.length > 0 && (
          <section id="galerie" className="mx-auto max-w-[1180px] scroll-mt-24 px-4 py-12 sm:px-6 sm:py-16">
            <div className="mb-7 flex items-end justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-[var(--color-primary)]">Réalisations</p><h2 className="mt-1 font-display text-3xl font-bold sm:text-4xl">Ils nous ont fait confiance</h2></div></div>
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0">
              {gallery.map((photo) => <figure key={photo.id} className="relative min-w-[72vw] snap-start overflow-hidden rounded-[22px] bg-gray-100 sm:min-w-0"><img src={photo.image_url} alt={photo.caption ?? ''} className="aspect-[4/3] h-full w-full object-cover" />{photo.caption && <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-10 text-xs text-white">{photo.caption}</figcaption>}</figure>)}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
