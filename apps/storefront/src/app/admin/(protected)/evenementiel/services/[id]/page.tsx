import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import ServiceDetailAdminClient from './ServiceDetailAdminClient';
import type { ServiceOffering, RentalItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';

export default async function AdminServiceDetailPage({ params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();

  const { data: offering } = await supabase
    .from('service_offerings')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!offering) notFound();

  const { data: rentalItems } = await supabase
    .from('rental_items')
    .select('*')
    .eq('service_offering_id', offering.id)
    .order('sort_order', { ascending: true });

  return (
    <div className="max-w-4xl">
      <ServiceDetailAdminClient
        offering={offering as ServiceOffering}
        initialRentalItems={(rentalItems ?? []) as RentalItem[]}
        currency={tenant.currency}
      />
    </div>
  );
}
