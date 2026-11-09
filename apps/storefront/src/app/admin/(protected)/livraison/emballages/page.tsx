import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminBlockAccent from '../../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { PackagingProfilesSection } from './PackagingProfilesSection';
import { PackagingWeightBandsSection } from './PackagingWeightBandsSection';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { isMissingPackagingWeightTable } from '@/lib/shipping/loadPackagingWeightBands';
import { bandsFromRows, type PackagingWeightBandRow } from '@/lib/shipping/packagingWeight';
import type { ShippingPackagingProfileRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminPackagingProfilesPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: profiles } = await supabase
    .from('shipping_packaging_profiles')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true }) as unknown as { data: ShippingPackagingProfileRow[] | null };

  // UI hint only: the write route re-checks shipping.manage.
  const access = await getCurrentAdminAccessContext(tenant.id);
  const canManage = Boolean(access && canAdmin(access, 'shipping.manage'));
  const bandsResult = await supabase
    .from('shipping_packaging_weight_bands')
    .select('min_weight_g_exclusive, max_weight_g_inclusive, added_weight_g')
    .eq('tenant_id', tenant.id);
  const migrationReady = !isMissingPackagingWeightTable(bandsResult.error as { code?: string } | null);
  const bands = bandsFromRows((bandsResult.data ?? []) as PackagingWeightBandRow[]);

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description="Catalogue des boîtes disponibles — utilisé par le laboratoire de simulation et l'assistant expédition."
        meta={`${(profiles ?? []).length} profil${(profiles ?? []).length !== 1 ? 's' : ''}`}
      />

      <PackagingWeightBandsSection initial={bands} canManage={canManage} migrationReady={migrationReady} />

      <AdminBlockAccent tone="info">
        <PackagingProfilesSection initialProfiles={profiles ?? []} />
      </AdminBlockAccent>
    </div>
  );
}
