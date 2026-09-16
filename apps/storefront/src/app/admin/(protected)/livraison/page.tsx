import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from './LivraisonTabs';
import { ShippingCountryRulesSection } from './ShippingCountryRulesSection';
import type { ShippingCountryRuleRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminLivraisonPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();

  const { data: rules } = await supabase
    .from('shipping_country_rules')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true }) as unknown as { data: ShippingCountryRuleRow[] | null };

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description="Définissez les règles par pays et vérifiez leur résultat avant de les exposer aux clients."
        meta={`${(rules ?? []).length} règle${(rules ?? []).length !== 1 ? 's' : ''}`}
      />

      <LivraisonTabs active="rules" />

      <AdminBlockAccent tone="info">
        <ShippingCountryRulesSection initialRules={rules ?? []} currency={tenant.currency} />
      </AdminBlockAccent>
    </div>
  );
}
