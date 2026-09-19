import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from '../LivraisonTabs';
import { TariffLabClient } from './TariffLabClient';
import type { ShippingTariffDraftRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminTariffLabPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: drafts } = await supabase
    .from('shipping_tariff_drafts')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description="Brouillons de tarifs commerciaux, jamais activés en checkout depuis cet écran — validez d'abord contre les données réelles."
      />

      <LivraisonTabs active="tarif-analyse" />

      <TariffLabClient initialDrafts={(drafts as ShippingTariffDraftRow[] | null) ?? []} />
    </div>
  );
}
