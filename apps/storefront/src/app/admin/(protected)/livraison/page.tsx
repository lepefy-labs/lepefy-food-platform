import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { ShippingCountryRulesSection } from './ShippingCountryRulesSection';
import type { ShippingCountryRuleRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const TAB_CLS =
  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
const TAB_ACTIVE   = 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]';
const TAB_INACTIVE = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800';

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
    <div className="max-w-4xl">
      <div className="flex items-center gap-1 mb-4">
        <span className={`${TAB_CLS} ${TAB_ACTIVE}`}>
          Règles par pays
        </span>
        <Link href="/admin/livraison/simulateur" className={`${TAB_CLS} ${TAB_INACTIVE}`}>
          Simulateur
        </Link>
      </div>

      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1">Règles de livraison par pays</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Gratuité au-delà d&apos;un seuil, forfait fixe ou remise — par pays ou pour tous les pays. Ces règles
        s&apos;appliquent au-dessus du mode de livraison par défaut de la boutique (Packlink ou forfait).
      </p>

      <ShippingCountryRulesSection initialRules={rules ?? []} currency={tenant.currency} />
    </div>
  );
}
