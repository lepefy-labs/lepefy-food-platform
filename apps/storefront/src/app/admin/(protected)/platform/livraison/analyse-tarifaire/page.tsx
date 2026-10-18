import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import type { ShippingTariffDraftRow } from '@lepefy/types';
import { TariffLabClient } from './TariffLabClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function PlatformTariffAnalysisPage() {
  if (await requirePlatformOwner()) redirect('/admin');
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');

  const { data: drafts } = await createServiceClient()
    .from('shipping_tariff_drafts')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  return (
    <div>
      <p className="mb-5 text-sm text-a-text-3">
        Brouillons de grilles et rétrotest sur les données Packlink et les commandes réelles. Jamais lus par le checkout.
      </p>
      <TariffLabClient initialDrafts={(drafts as ShippingTariffDraftRow[] | null) ?? []} />
    </div>
  );
}
