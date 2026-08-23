import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { ShippingCountryRulesSection } from './ShippingCountryRulesSection';
import type { ShippingCountryRuleRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const TAB_CLS = 'min-h-10 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors';
const TAB_ACTIVE = 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] ring-1 ring-[#D9D3FF]';
const TAB_INACTIVE = 'text-gray-500 dark:text-gray-400 hover:bg-white hover:text-gray-900 dark:hover:bg-gray-900 dark:hover:text-gray-100';

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

      <div className="mb-5 inline-flex gap-1 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface-subtle)] p-1.5">
        <span className={`${TAB_CLS} ${TAB_ACTIVE}`}>Règles par pays</span>
        <Link href="/admin/livraison/simulateur" className={`${TAB_CLS} ${TAB_INACTIVE}`}>
          Simulateur
        </Link>
      </div>

      <AdminBlockAccent tone="info">
        <ShippingCountryRulesSection initialRules={rules ?? []} currency={tenant.currency} />
      </AdminBlockAccent>
    </div>
  );
}
