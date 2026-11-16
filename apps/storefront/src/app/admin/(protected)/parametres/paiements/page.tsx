import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { ALL_PAYMENT_MODULES } from '@/lib/payments/paymentMethodForm';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { PaymentMethodsSection } from '../PaymentMethodsSection';
import type { TenantPaymentMethod } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresPaiementsPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();
  const { data: paymentMethods } = await supabase
    .from('tenant_payment_methods')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  const normalizedMethods = ((paymentMethods ?? []) as TenantPaymentMethod[])
    .map((m) => ({ ...m, enabled_modules: m.enabled_modules ?? ALL_PAYMENT_MODULES }));

  return (
    <SettingsPageShell
      sectionKey="paiements"
      description="Les moyens de paiement que vos clients voient, dans quel ordre et sur quels services (boutique, /card, événements, location)."
    >
      <PaymentMethodsSection initialMethods={normalizedMethods} />
    </SettingsPageShell>
  );
}
