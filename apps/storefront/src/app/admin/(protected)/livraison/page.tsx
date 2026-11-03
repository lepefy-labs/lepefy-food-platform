import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { ShippingCountryRulesSection } from './ShippingCountryRulesSection';
import { ZonesSection } from './ZonesSection';
import { GeoPolicySection } from './GeoPolicySection';
import { loadConfiguredCountries, loadGeoPolicy } from '@/lib/shipping/geo/geoPolicyServer';
import { defaultGeoPolicy } from '@/lib/shipping/geo/geoPolicy';
import type { ShippingCountryRuleRow, ShippingZoneRow } from '@lepefy/types';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { loadPricingMode } from '@/lib/shipping/tariff/adminData';
import { effectivePricingMode } from '@/lib/shipping/tariff/checkoutShipping';

const PRICING_MODE_LABEL = {
  provider_cost: 'Coût Packlink en direct',
  shadow: 'Coût Packlink (grille en observation)',
  tariff: 'Grille tarifaire (forfait)',
} as const;

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminLivraisonPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();

  const [access, storedMode] = await Promise.all([
    getCurrentAdminAccessContext(tenant.id),
    loadPricingMode(supabase, tenant.id),
  ]);
  // UI hint only: every write route re-checks shipping.manage.
  const canManage = Boolean(access && canAdmin(access, 'shipping.manage'));
  const pricingMode = effectivePricingMode({ shipping_pricing_mode: storedMode });

  const { data: rules } = await supabase
    .from('shipping_country_rules')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true }) as unknown as { data: ShippingCountryRuleRow[] | null };

  const { data: zones } = await supabase
    .from('shipping_zones')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true }) as unknown as { data: ShippingZoneRow[] | null };

  // Migration 179 absente → la table ne répond pas; la section reste en lecture seule.
  const geoProbe = await supabase.from('tenant_shipping_geo_policy').select('tenant_id').eq('tenant_id', tenant.id).maybeSingle();
  const geoMigrationReady = !geoProbe.error;
  const [geoPolicy, configuredCountries] = await Promise.all([
    geoMigrationReady ? loadGeoPolicy(supabase, tenant.id) : Promise.resolve(defaultGeoPolicy()),
    loadConfiguredCountries(supabase, tenant.id),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description="Définissez les règles par pays et vérifiez leur résultat avant de les exposer aux clients."
        meta={`${(rules ?? []).length} règle${(rules ?? []).length !== 1 ? 's' : ''}`}
      />


      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-a-border bg-a-surface px-4 py-3 text-sm">
        <span className="rounded-full bg-a-brand-soft px-2.5 py-1 text-xs font-semibold text-a-brand-fg">
          Mode : {PRICING_MODE_LABEL[pricingMode]}
        </span>
        <span className="text-a-text-3">
          Ordre appliqué : <strong className="font-medium text-a-text">prix de base → forfait fixe → remise → gratuité</strong> · la règle d&apos;un pays prime sur « Tous les pays ».
        </span>
        {!canManage && <span className="ml-auto rounded-full bg-a-hover px-2.5 py-1 text-xs font-medium text-a-text-2">Lecture seule</span>}
      </div>

      <AdminBlockAccent tone="info">
        <ShippingCountryRulesSection initialRules={rules ?? []} currency={tenant.currency} canManage={canManage} />
      </AdminBlockAccent>

      <GeoPolicySection initial={geoPolicy} configuredCountries={configuredCountries} canManage={canManage} migrationReady={geoMigrationReady} />

      <ZonesSection initialZones={zones ?? []} canManage={canManage} tariffMode={pricingMode === 'tariff'} />
    </div>
  );
}
