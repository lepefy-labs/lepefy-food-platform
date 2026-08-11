import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { IconCalendarEvent, IconMapPin, IconClock, IconUsers, IconChefHat, IconTools, IconArrowRight } from '@tabler/icons-react';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatEventDayDate, formatEventTime, formatPrice } from '@/lib/utils/format';
import { EventImageFader } from '@/components/evenementiel/EventImageFader';
import type { EventRow, ServiceOffering, EventGalleryPhoto } from '@lepefy/types';

type EventPhotoRef = Pick<EventGalleryPhoto, 'event_id' | 'image_url'>;

export const revalidate = 120;

export async function generateMetadata(): Promise<Metadata> {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  return {
    title: 'Événementiel',
    description: `Soirées, traiteur et location de matériel — ${tenant.name}.`,
  };
}

export default async function EvenementielHubPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  if (!tenant.events_enabled && !tenant.services_enabled) {
    notFound();
  }

  const supabase = createPublicClient();

  const [eventsRes, servicesRes, galleryRes, eventPhotosRes] = await Promise.all([
    tenant.events_enabled
      ? supabase
          .from('events')
          .select('*')
          .eq('tenant_id', tenant.id)
          .eq('status', 'published')
          .gte('date_start', new Date().toISOString())
          .order('date_start', { ascending: true })
      : Promise.resolve({ data: [] as EventRow[] }),
    tenant.services_enabled
      ? supabase
          .from('service_offerings')
          .select('*')
          .eq('tenant_id', tenant.id)
          .eq('active', true)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] as ServiceOffering[] }),
    tenant.events_enabled
      ? supabase
          .from('event_gallery_photos')
          .select('*')
          .eq('tenant_id', tenant.id)
          .order('sort_order', { ascending: true })
          .limit(8)
      : Promise.resolve({ data: [] as EventGalleryPhoto[] }),
    // Photos multi-image par événement (carousel auto-fade des cards) — pas de
    // filtre .in(event_id) ici : les ids des events du Promise.all voisin ne
    // sont pas encore connus au moment de construire cette requête (même
    // Promise.all = exécution parallèle, pas séquentielle). On récupère donc
    // toutes les photos rattachées à un événement pour ce tenant et on
    // regroupe par event_id en JS ci-dessous ; les events non retournés
    // ci-dessus (brouillon, passés) ne seront simplement jamais lookup.
    tenant.events_enabled
      ? supabase
          .from('event_gallery_photos')
          .select('event_id, image_url')
          .eq('tenant_id', tenant.id)
          .not('event_id', 'is', null)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] as EventPhotoRef[] }),
  ]);

  const events   = (eventsRes.data ?? []) as EventRow[];
  const services = (servicesRes.data ?? []) as ServiceOffering[];
  const gallery  = (galleryRes.data ?? []) as EventGalleryPhoto[];

  const photosByEvent = new Map<string, string[]>();
  for (const photo of (eventPhotosRes.data ?? []) as EventPhotoRef[]) {
    if (!photo.event_id) continue;
    const list = photosByEvent.get(photo.event_id) ?? [];
    list.push(photo.image_url);
    photosByEvent.set(photo.event_id, list);
  }

  return (
    <div className="min-h-screen bg-[#f7f9f8]">
      {/* ── Hero ── */}
      {/* Dégradé mono-teinte dérivé du seul --color-primary du tenant (formule
          alignée sur le mockup validé), plus jamais primary→secondary : ce
          dernier produisait un rendu bicolore (vert→jaune pour ChloeFood)
          perçu comme "générique", sans lien avec l'identité du tenant. */}
      <section
        className="relative overflow-hidden px-4 py-20 sm:py-28 text-center text-white"
        style={{ background: 'linear-gradient(160deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}
      >
        {/* Motif triangles SVG en overlay — repris à l'identique du mockup
            (Maquette_Evenementiel_ChloeFood.html, .hero-pattern / pattern#tri) */}
        <svg
          className="absolute inset-0 w-full h-full opacity-[.14] pointer-events-none"
          viewBox="0 0 200 200"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <pattern id="evenementiel-hero-tri" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
              <polygon points="12,2 22,20 2,20" fill="none" stroke="#ffffff" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="200" height="200" fill="url(#evenementiel-hero-tri)" />
        </svg>

        <div className="relative z-[2] max-w-2xl mx-auto">
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-5"
            style={{ color: 'var(--color-secondary)' }}
          >
            Traiteur · Barbecue · Location de matériel
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-bold mb-5 leading-[1.08]">
            Soirées, traiteur &amp; location de matériel avec {tenant.name}
          </h1>
          <p className="text-sm sm:text-base text-white/85 max-w-xl mx-auto mb-8">
            Réservez votre place à nos soirées barbecue, demandez un devis traiteur ou louez le matériel
            qu&apos;il vous faut pour votre événement.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href="#evenements"
              className="text-sm font-semibold px-7 py-3.5 rounded-[10px] transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: 'var(--color-secondary)', color: 'var(--color-primary-dark)' }}
            >
              Voir les événements à venir
            </a>
            <a
              href="#services"
              className="text-sm font-semibold px-7 py-3.5 rounded-[10px] border border-white/45 text-white transition-colors hover:border-[var(--color-secondary)] hover:text-[var(--color-secondary)]"
            >
              Découvrir nos services
            </a>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto w-full px-4">

        {/* ── Soirées barbecue ── */}
        {tenant.events_enabled && (
          <section id="evenements" className="py-10 scroll-mt-[92px]">
            <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900 mb-1">
              Nos soirées barbecue
            </h2>
            <p className="text-sm text-gray-500 mb-6">Réservez votre formule et recevez votre billet par QR code.</p>

            {events.length === 0 ? (
              <p className="text-sm text-gray-400 bg-white rounded-2xl border border-gray-100 p-6 text-center">
                Aucun événement à venir pour le moment — revenez bientôt !
              </p>
            ) : (
              <div className="flex flex-wrap justify-center gap-4">
                {events.map((event, index) => {
                  const eventImages = photosByEvent.get(event.id) ?? (event.banner_image_url ? [event.banner_image_url] : []);
                  // `events` arrive déjà trié par date_start ascendant (requête
                  // server-side ci-dessus) — index 0 = événement le plus proche,
                  // pas de re-tri nécessaire ici (voir Step 0, deviation report).
                  const isNext = index === 0;
                  const isSoldOut = event.capacity_remaining <= 0;
                  return (
                  <Link
                    key={event.id}
                    href={`/evenementiel/evenements/${event.slug}`}
                    className="group flex basis-full sm:basis-[calc(50%-0.5rem)] bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5"
                  >
                    <EventImageFader
                      images={eventImages}
                      fallbackColor="var(--color-primary-light)"
                      className="w-[110px] sm:w-[130px] shrink-0 self-stretch bg-gray-100"
                    >
                      {isSoldOut ? (
                        <span className="absolute top-2 left-2 text-2xs font-semibold px-2 py-1 rounded-full bg-white/90 text-red-600">
                          Complet
                        </span>
                      ) : isNext ? (
                        // Colonne image fixe (110/130px) trop étroite pour "PROCHAIN
                        // ÉVÉNEMENT" en une ligne à une taille lisible — vérifié
                        // empiriquement (mockup_hub_card.png ne montrait que le rendu
                        // large) : wrap 2 lignes/rounded-lg sous sm, pill 1 ligne dès sm.
                        <span
                          className="absolute top-2 left-2 right-2 sm:right-auto whitespace-normal sm:whitespace-nowrap text-[9px] font-bold leading-tight px-1.5 py-1 rounded-lg sm:rounded-full"
                          style={{ backgroundColor: 'var(--color-secondary)', color: 'var(--color-primary-dark)' }}
                        >
                          PROCHAIN ÉVÉNEMENT
                        </span>
                      ) : null}
                    </EventImageFader>
                    <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
                      <div className="space-y-1">
                        <p
                          className="text-2xs font-semibold uppercase tracking-wide flex items-center gap-1"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          <IconCalendarEvent size={13} /> {formatEventDayDate(event.date_start)}
                        </p>
                        <h3 className="font-semibold text-gray-900 line-clamp-1">{event.title}</h3>
                        {event.location && (
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <IconMapPin size={13} /> {event.location}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                          <IconClock size={13} /> {formatEventTime(event.date_start)}
                        </p>
                        {event.capacity_remaining > 0 && (
                          <p className="text-xs text-green-600 flex items-center gap-1">
                            <IconUsers size={13} /> {event.capacity_remaining} places disponibles
                          </p>
                        )}
                      </div>
                      <span
                        className="text-[13px] font-semibold flex items-center justify-center gap-1.5 text-white rounded-[10px] mt-1 py-2.5 transition-colors group-hover:[background-color:var(--color-primary-dark)]"
                        style={{ backgroundColor: 'var(--color-primary)' }}
                      >
                        Réserve ta place <IconArrowRight size={14} />
                      </span>
                    </div>
                  </Link>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Services ── */}
        {tenant.services_enabled && services.length > 0 && (
          <section id="services" className="py-10 scroll-mt-[92px]">
            <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900 mb-1">Nos services</h2>
            <p className="text-sm text-gray-500 mb-6">Traiteur sur mesure et location de matériel pour vos événements.</p>

            <div className="grid sm:grid-cols-2 gap-4">
              {services.map((service) => (
                <Link
                  key={service.id}
                  href={`/evenementiel/services/${service.slug}`}
                  className="group bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow flex"
                >
                  <div
                    className="w-28 shrink-0 bg-cover bg-center flex items-center justify-center"
                    style={{
                      backgroundImage: service.cover_image_url ? `url(${service.cover_image_url})` : undefined,
                      backgroundColor: service.cover_image_url ? undefined : 'var(--color-primary-light)',
                    }}
                  >
                    {!service.cover_image_url && (
                      service.type === 'traiteur'
                        ? <IconChefHat size={28} color="var(--color-primary)" />
                        : <IconTools size={28} color="var(--color-primary)" />
                    )}
                  </div>
                  <div className="p-4 flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">{service.title}</h3>
                    {service.description && (
                      <p className="text-xs text-gray-500 line-clamp-2 mb-2">{service.description}</p>
                    )}
                    <span
                      className="text-xs font-semibold inline-flex items-center gap-1"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {service.cta_type === 'devis' ? 'Demander un devis' : 'Voir le catalogue'} <IconArrowRight size={13} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── Galerie ── */}
        {gallery.length > 0 && (
          <section id="galerie" className="py-10 scroll-mt-[92px]">
            <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900 mb-1">Nos événements passés</h2>
            <p className="text-sm text-gray-500 mb-6">Un aperçu de l&apos;ambiance de nos soirées.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {gallery.map((photo) => (
                <div key={photo.id} className="aspect-square rounded-2xl overflow-hidden bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.image_url} alt={photo.caption ?? ''} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Le CTA de clôture ("Nous contacter" + retour boutique) vit
            désormais dans EventsFooter, rendu par (evenementiel)/layout.tsx
            sur TOUTES les pages du module — cette section dupliquait le même
            rôle uniquement sur le hub, avec un lien boutique relatif
            (invalide depuis events.chloefood.com). Supprimée au profit du
            footer dédié, conforme au mockup validé (une seule footer-cta). */}
        <div className="h-6" />
      </div>
    </div>
  );
}
