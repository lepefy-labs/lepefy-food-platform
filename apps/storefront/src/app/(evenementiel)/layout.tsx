import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantSocialLinks } from '@/lib/tenant/getTenantSocialLinks';
import { createPublicClient } from '@/lib/supabase/public';
import { EventsHeader } from './_components/EventsHeader';
import { EventsFooter } from './_components/EventsFooter';

type ServiceCapabilityRow = {
  type: string | null;
  cta_type: string | null;
};

export default async function EvenementielLayout({ children }: { children: React.ReactNode }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createPublicClient();

  const [socialLinks, featuredEventRes, servicesRes, galleryRes] = await Promise.all([
    getTenantSocialLinks(tenant.id),
    tenant.events_enabled
      ? supabase
          .from('events')
          .select('slug')
          .eq('tenant_id', tenant.id)
          .eq('status', 'published')
          .gte('date_start', new Date().toISOString())
          .order('date_start', { ascending: true })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null as { slug: string } | null }),
    tenant.services_enabled
      ? supabase
          .from('service_offerings')
          .select('type, cta_type')
          .eq('tenant_id', tenant.id)
          .eq('active', true)
      : Promise.resolve({ data: [] as ServiceCapabilityRow[] }),
    tenant.events_enabled
      ? supabase
          .from('event_gallery_photos')
          .select('id')
          .eq('tenant_id', tenant.id)
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  const services = (servicesRes.data ?? []) as ServiceCapabilityRow[];
  const hasTraiteur = services.some((service) => service.type === 'traiteur' || service.cta_type === 'devis');
  const hasLocation = services.some((service) => service.type === 'location_materiel' || service.cta_type === 'reservation');
  const hasGallery = (galleryRes.data?.length ?? 0) > 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f3eb]">
      <EventsHeader
        tenant={tenant}
        socialLinks={socialLinks}
        featuredEventSlug={featuredEventRes.data?.slug ?? null}
        hasTraiteur={hasTraiteur}
        hasLocation={hasLocation}
        hasGallery={hasGallery}
      />
      <main className="flex-1 pt-20">{children}</main>
      <EventsFooter tenant={tenant} hasTraiteur={hasTraiteur} hasLocation={hasLocation} />
    </div>
  );
}
