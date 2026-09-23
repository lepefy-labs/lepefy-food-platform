import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from '../LivraisonTabs';
import { ForfaitShadowClient } from './ForfaitShadowClient';
import { loadForfaitShadowAdminData } from '@/lib/shipping/tariff/adminData';
import { loadShadowReport, reportPeriod } from '@/lib/shipping/tariff/shadowReport';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminForfaitShadowPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();
  const data = await loadForfaitShadowAdminData(supabase, tenant.id);

  const period = reportPeriod(null, null)!;
  const initialReport = data.migrationReady ? await loadShadowReport(supabase, tenant.id, period) : null;

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description="Versions tarifaires figées : simulation shadow, puis activation explicite pour les clients. Rien n'est facturé sans confirmation."
      />

      <LivraisonTabs active="forfait-shadow" />

      <ForfaitShadowClient
        data={data}
        initialPeriod={{ from: period.fromIso.slice(0, 10), to: period.toIso.slice(0, 10) }}
        initialReport={initialReport && !('error' in initialReport) ? initialReport : null}
      />
    </div>
  );
}
