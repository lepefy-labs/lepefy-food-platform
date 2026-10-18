import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { resolveCountryRule } from '@/lib/shipping/resolveCountryRule';
import { describeCountryRule } from '@/lib/shipping/tariff/activationChecklist';
import { loadForfaitShadowAdminData } from '@/lib/shipping/tariff/adminData';
import { buildCountryTariffViews, buildTariffHistory, countryFlag, countryLabel } from '@/lib/shipping/tariff/tariffEdit';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from '../LivraisonTabs';
import { ForfaitClient, type ForfaitCountryCard, type ForfaitHistoryItem } from './ForfaitClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Page commerciale du forfait : prix facturés par pays, modification rapide
// (nouvelle version immuable publiée par POST /api/admin/shipping-tariff-versions/publish),
// historique et paramètres avancés. Les outils techniques (shadow, simulation,
// rétrotest, rapport) sont dans /admin/platform/livraison/forfait-laboratoire.
export default async function AdminForfaitPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();
  const [data, access] = await Promise.all([
    loadForfaitShadowAdminData(supabase, tenant.id),
    getCurrentAdminAccessContext(tenant.id),
  ]);
  // UI hint only: every write route re-checks its permission server-side.
  const canManage = Boolean(access && canAdmin(access, 'shipping.manage'));
  const isPlatformOwner = Boolean(access?.isPlatformOwner);

  const countries: ForfaitCountryCard[] = buildCountryTariffViews(data.versions, data.knownCountries).map((view) => {
    const rule = resolveCountryRule(view.country, data.countryRules);
    return {
      ...view,
      label: countryLabel(view.country),
      flag: countryFlag(view.country),
      ruleNote: rule ? describeCountryRule(rule) : null,
    };
  });

  const history: ForfaitHistoryItem[] = buildTariffHistory(data.versions).map((entry) => ({
    ...entry,
    label: countryLabel(entry.version.country),
    flag: countryFlag(entry.version.country),
    activatedByEmail: entry.version.activated_by ? data.adminEmails[entry.version.activated_by] ?? null : null,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description="Frais de livraison facturés aux clients, par pays."
      />

      <LivraisonTabs active="forfait" />

      <ForfaitClient
        countries={countries}
        history={history}
        canManage={canManage}
        isPlatformOwner={isPlatformOwner}
        migrationReady={data.migrationReady}
        activationReady={data.activationReady}
        pricingMode={data.pricingMode}
        fallback={data.fallback}
        publicGridEnabled={data.publicGridEnabled}
        missingWeightProducts={data.missingWeightProducts.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
