import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { PaymentMethodsSection } from '../PaymentMethodsSection';
import type { TenantPaymentMethod } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresPaiementsPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: paymentMethods } = await supabase
    .from('tenant_payment_methods')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1">Moyens de paiement</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Configuration des moyens de paiement proposés à vos clients.
      </p>

      <PaymentMethodsSection initialMethods={(paymentMethods ?? []) as TenantPaymentMethod[]} />
    </div>
  );
}
