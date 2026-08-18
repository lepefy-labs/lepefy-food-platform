import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { PaymentMethodsSection } from '../PaymentMethodsSection';
import type { TenantPaymentMethod, PaymentModule } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Même défaut que la colonne `enabled_modules` (migration 066) — tant que
// la migration n'a pas encore été appliquée sur l'environnement, la colonne
// est absente de `select('*')` et vaut `undefined` sur chaque ligne.
const DEFAULT_ENABLED_MODULES: PaymentModule[] = ['shop', 'card', 'event', 'rental'];

export default async function ParametresPaiementsPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: paymentMethods } = await supabase
    .from('tenant_payment_methods')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  const normalizedMethods = ((paymentMethods ?? []) as TenantPaymentMethod[]).map((m) => ({
    ...m,
    enabled_modules: m.enabled_modules ?? DEFAULT_ENABLED_MODULES,
  }));

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1">Moyens de paiement</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Configuration des moyens de paiement proposés à vos clients.
      </p>

      <PaymentMethodsSection initialMethods={normalizedMethods} />
    </div>
  );
}
