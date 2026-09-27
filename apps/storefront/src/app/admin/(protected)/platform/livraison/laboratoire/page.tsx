import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { ShippingSimulator } from './ShippingSimulator';
import { CampaignManager } from './CampaignManager';
import { PostalCodeIndexAdmin } from './PostalCodeIndexAdmin';
import type { ShippingPackagingProfileRow, ShippingZoneRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminLaboratoirePage() {
  if (await requirePlatformOwner()) redirect('/admin');
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const [{ data: profiles }, { data: zones }] = await Promise.all([
    supabase.from('shipping_packaging_profiles').select('*').eq('tenant_id', tenant.id).eq('active', true).order('position', { ascending: true }),
    supabase.from('shipping_zones').select('*').eq('tenant_id', tenant.id).eq('active', true).order('position', { ascending: true }),
  ]);

  return (
    <div>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        Test rapide ponctuel, ou campagne de simulation bornée pour construire l&apos;historique de coûts utilisé par l&apos;assistant, l&apos;historique et l&apos;analyse tarifaire du tenant.
      </p>

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Test rapide</h2>
        <p className="text-xs text-gray-400 mb-4">Un devis Packlink ponctuel — alimente désormais l&apos;historique de coûts au lieu d&apos;être jeté.</p>
        <ShippingSimulator shippingProvider={tenant.shipping_provider} currency={tenant.currency} />
      </section>

      <CampaignManager
        profiles={(profiles as ShippingPackagingProfileRow[] | null) ?? []}
        zones={(zones as ShippingZoneRow[] | null) ?? []}
      />

      <div className="mt-6">
        <PostalCodeIndexAdmin />
      </div>
    </div>
  );
}
