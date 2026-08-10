import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import DevisForm from './DevisForm';
import RentalCheckoutClient from './RentalCheckoutClient';
import type { ServiceOffering, RentalItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
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
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
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

  return (
    <div className="min-h-screen bg-[#f7f9f8]">
      <div
        className="h-40 sm:h-56 bg-cover bg-center"
        style={{
          backgroundImage: serviceOffering.cover_image_url ? `url(${serviceOffering.cover_image_url})` : undefined,
          backgroundColor: serviceOffering.cover_image_url ? undefined : 'var(--color-primary)',
        }}
      />

      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{serviceOffering.title}</h1>
        {serviceOffering.description && (
          <p className="text-sm text-gray-700 whitespace-pre-line mb-6">{serviceOffering.description}</p>
        )}

        {serviceOffering.cta_type === 'devis' ? (
          <DevisForm serviceSlug={serviceOffering.slug} />
        ) : (
          <RentalCheckoutClient
            service={{ id: serviceOffering.id, slug: serviceOffering.slug, title: serviceOffering.title }}
            rentalItems={rentalItems}
            tenant={{ currency: tenant.currency }}
          />
        )}
      </div>
    </div>
  );
}
