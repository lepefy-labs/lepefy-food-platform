import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import RentalDeliveryZonesClient from './RentalDeliveryZonesClient';
import type { RentalDeliveryZone } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminRentalDeliveryZonesPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: zones } = await supabase
    .from('rental_delivery_zones')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-gray-950 dark:text-white">Livraison matériel</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500 dark:text-gray-400">
        Configurez les pays où la livraison est proposée et les zones avec un supplément fixe calculé automatiquement au checkout.
      </p>
      <RentalDeliveryZonesClient
        initialZones={(zones ?? []) as RentalDeliveryZone[]}
        currency={tenant.currency}
        initialDeliveryEnabled={tenant.rental_delivery_enabled}
        initialCountries={tenant.rental_delivery_countries ?? []}
      />
    </div>
  );
}
