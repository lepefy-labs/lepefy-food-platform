import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { IconCalendarEvent, IconMapPin, IconChefHat, IconTools, IconArrowRight } from '@tabler/icons-react';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatDate, formatPrice } from '@/lib/utils/format';
import type { EventRow, ServiceOffering, EventGalleryPhoto } from '@lepefy/types';

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

  const [eventsRes, servicesRes, galleryRes] = await Promise.all([
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
  ]);

  const events   = (eventsRes.data ?? []) as EventRow[];
  const services = (servicesRes.data ?? []) as ServiceOffering[];
  const gallery  = (galleryRes.data ?? []) as EventGalleryPhoto[];

  return (
    <div className="min-h-screen bg-[#f7f9f8]">
      {/* ── Hero ── */}
      <section
        className="relative overflow-hidden px-4 py-14 sm:py-20 text-center text-white"
        style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))' }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest opacity-80 mb-3">Événementiel</p>
        <h1 className="font-display text-2xl sm:text-4xl font-bold mb-3 max-w-2xl mx-auto">
          Soirées, traiteur &amp; location de matériel avec {tenant.name}
        </h1>
        <p className="text-sm sm:text-base opacity-90 max-w-xl mx-auto">
          Réservez votre place à nos soirées barbecue, demandez un devis traiteur ou louez le matériel
          qu&apos;il vous faut pour votre événement.
        </p>
      </section>

      <div className="max-w-6xl mx-auto w-full px-4">

        {/* ── Soirées barbecue ── */}
        {tenant.events_enabled && (
          <section className="py-10">
            <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900 mb-1">
              Nos soirées barbecue
            </h2>
            <p className="text-sm text-gray-500 mb-6">Réservez votre formule et recevez votre billet par QR code.</p>

            {events.length === 0 ? (
              <p className="text-sm text-gray-400 bg-white rounded-2xl border border-gray-100 p-6 text-center">
                Aucun événement à venir pour le moment — revenez bientôt !
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {events.map((event) => (
                  <Link
                    key={event.id}
                    href={`/evenementiel/evenements/${event.slug}`}
                    className="group bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
                  >
                    <div
                      className="h-36 bg-gray-100 bg-cover bg-center flex items-end p-3"
                      style={{
                        backgroundImage: event.banner_image_url ? `url(${event.banner_image_url})` : undefined,
                        backgroundColor: event.banner_image_url ? undefined : 'var(--color-primary-light)',
                      }}
                    >
                      {event.capacity_remaining <= 0 && (
                        <span className="text-2xs font-semibold px-2 py-1 rounded-full bg-white/90 text-red-600">
                          Complet
                        </span>
                      )}
                    </div>
                    <div className="p-4">
                      <p
                        className="text-2xs font-semibold uppercase tracking-wide mb-1 flex items-center gap-1"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        <IconCalendarEvent size={13} /> {formatDate(event.date_start)}
                      </p>
                      <h3 className="font-semibold text-gray-900 mb-1 line-clamp-1">{event.title}</h3>
                      {event.location && (
                        <p className="text-xs text-gray-500 flex items-center gap-1 mb-2">
                          <IconMapPin size={13} /> {event.location}
                        </p>
                      )}
                      <span
                        className="text-xs font-semibold inline-flex items-center gap-1 group-hover:gap-1.5 transition-all"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        Voir les formules <IconArrowRight size={13} />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Services ── */}
        {tenant.services_enabled && services.length > 0 && (
          <section className="py-10">
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
          <section className="py-10">
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

        {/* ── Footer CTA ── */}
        <section className="py-10 text-center">
          <div
            className="rounded-2xl p-8"
            style={{ backgroundColor: 'var(--color-primary-light)' }}
          >
            <h2 className="font-display text-lg font-bold text-gray-900 mb-2">Une question sur nos prestations ?</h2>
            <p className="text-sm text-gray-600 mb-4">
              Contactez-nous directement, notre équipe vous répondra rapidement.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-5 py-2.5 rounded-xl text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              Retour à la boutique <IconArrowRight size={14} />
            </Link>
          </div>
        </section>

        <div className="h-6" />
      </div>
    </div>
  );
}
