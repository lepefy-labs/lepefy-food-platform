import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { loadForfaitShadowAdminData } from '@/lib/shipping/tariff/adminData';
import { loadShadowReport, reportPeriod } from '@/lib/shipping/tariff/shadowReport';
import { ForfaitLabClient } from './ForfaitLabClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Laboratoire forfait (platform_owner) : toutes les versions, création depuis un
// brouillon, collecte shadow, simulation, activation avec checklist complète et
// rapport sur les commandes réelles. Le tenant modifie ses prix depuis
// /admin/livraison/forfait.
export default async function PlatformForfaitLabPage() {
  if (await requirePlatformOwner()) redirect('/admin');
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();
  const data = await loadForfaitShadowAdminData(supabase, tenant.id);

  const period = reportPeriod(null, null)!;
  const initialReport = data.migrationReady ? await loadShadowReport(supabase, tenant.id, period) : null;

  return (
    <div>
      <p className="mb-5 text-sm text-a-text-3">
        Versions tarifaires figées, collecte shadow, simulation et rapport sur les commandes réelles. La page commerciale du tenant reste <Link href="/admin/livraison/forfait" className="font-semibold text-a-brand-fg underline">Livraison → Forfait</Link>.
      </p>
      <ForfaitLabClient
        data={data}
        initialPeriod={{ from: period.fromIso.slice(0, 10), to: period.toIso.slice(0, 10) }}
        initialReport={initialReport && !('error' in initialReport) ? initialReport : null}
      />
    </div>
  );
}
