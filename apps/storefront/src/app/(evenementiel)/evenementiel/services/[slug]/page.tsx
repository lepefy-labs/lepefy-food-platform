import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { loadHeroGallery } from '@/lib/events/loadHeroGallery';
import { selectCateringHeroMedia } from '@/lib/events/selectHeroMedia';
import CateringLanding from './CateringLanding';
import RentalCheckoutClient from './RentalCheckoutClient';
import type { ServiceOffering, RentalItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createPublicClient();
  const { data: offering } = await supabase
    .from('service_offerings')
    .select('title')
    .eq('tenant_id', tenant.id)
    .eq('slug', params.slug)
    .eq('active', true)
    .maybeSingle();

  return { title: offering?.title ?? 'Service' };
}

export default async function ServiceDetailPage({ params }: PageProps) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  if (!tenant.services_enabled) notFound();

  const supabase = createPublicClient();
  const { data: offering } = await supabase
    .from('service_offerings')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('slug', params.slug)
    .eq('active', true)
    .maybeSingle();

  if (!offering) notFound();
  const serviceOffering = offering as ServiceOffering;

  let rentalItems: RentalItem[] = [];
  if (serviceOffering.cta_type === 'reservation') {
    const { data } = await supabase
      .from('rental_items')
      .select('*')
      .eq('service_offering_id', serviceOffering.id)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    rentalItems = (data ?? []) as RentalItem[];
  }

  const allPaymentMethods = await getTenantPaymentMethods(tenant.id);
  const externalPaymentMethods = allPaymentMethods.filter(
    (m) => m.method !== 'bank_transfer' && m.method !== 'cash' && !!m.extra?.link
      && m.enabled_modules.includes('rental'),
  );

  if (serviceOffering.cta_type === 'devis') {
    const cateringPhotos = await loadHeroGallery(supabase, tenant.id, ['traiteur']);
    const cateringHeroImages = selectCateringHeroMedia(cateringPhotos, serviceOffering.cover_image_url);
    const whatsappNumber = tenant.whatsapp_number?.replace(/\D/g, '');
    const whatsappHref = whatsappNumber
      ? 'https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent('Bonjour, je souhaite échanger sur une prestation traiteur.')
      : null;

    return (
      <CateringLanding
        serviceSlug={serviceOffering.slug}
        description={serviceOffering.description}
        heroImages={cateringHeroImages}
        photos={cateringPhotos.filter((photo) => photo.category === 'traiteur').map(({ id, image_url, caption }) => ({ id, image_url, caption }))}
        whatsappHref={whatsappHref}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f3eb] text-[#20231f]">
      <section className="mx-auto max-w-[1180px] px-4 pb-5 pt-9 sm:px-6 sm:pb-7 sm:pt-12">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">Service location</p>
        <h1 className="mt-2 font-display text-4xl font-semibold sm:text-5xl">Location de matériel</h1>
        {serviceOffering.description && <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-gray-600 sm:text-base">{serviceOffering.description}</p>}
      </section>
      <main className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-6">
        <RentalCheckoutClient
          service={{ id: serviceOffering.id, slug: serviceOffering.slug, title: serviceOffering.title }}
          rentalItems={rentalItems}
          tenant={{ currency: tenant.currency }}
          externalPaymentMethods={externalPaymentMethods}
        />
      </main>
    </div>
  );
}
