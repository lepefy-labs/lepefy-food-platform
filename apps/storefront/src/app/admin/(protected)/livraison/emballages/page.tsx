import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminBlockAccent from '../../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from '../LivraisonTabs';
import { PackagingProfilesSection } from './PackagingProfilesSection';
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

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description="Catalogue des boîtes disponibles — utilisé par le laboratoire de simulation et l'assistant expédition."
        meta={`${(profiles ?? []).length} profil${(profiles ?? []).length !== 1 ? 's' : ''}`}
      />

      <LivraisonTabs active="packaging" />

      <AdminBlockAccent tone="info">
        <PackagingProfilesSection initialProfiles={profiles ?? []} />
      </AdminBlockAccent>
    </div>
  );
}
