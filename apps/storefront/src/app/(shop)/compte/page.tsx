import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { getCustomerProfile } from '@/lib/customers/getCustomerProfile';
import { createServiceClient } from '@/lib/supabase/server';
import type { Address } from '@lepefy/types';
import { AccountDashboard } from './AccountDashboard';

// Tableau de bord "Mon compte" — lit la session à chaque requête (comme
// connexion/page.tsx et parrainage/page.tsx), jamais statique/ISR.
export const dynamic = 'force-dynamic';

export default async function ComptePage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) redirect('/compte/connexion');

  const profile = await getCustomerProfile(customer.id, tenant.id);

  const supabase = createServiceClient();

  const { data: ambassadorRow } = await supabase
    .from('customers')
    .select('is_ambassador, ambassador_profile_completed_at')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  const { data: addresses } = await supabase
    .from('addresses')
    .select('*')
    .eq('customer_id', customer.id)
    .eq('tenant_id', tenant.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  // Le solde de points n'est interrogé que si le programme est actif pour ce
  // tenant — un tenant qui n'a pas activé loyalty_enabled n'a pas de ledger
  // pertinent à afficher (cf. rapport final : aucun "niveau" fictif n'est
  // affiché non plus, la notion n'existe nulle part côté données réelles).
  let confirmedPoints = 0;
  if (tenant.loyalty_enabled) {
    const { data: balance } = await supabase
      .from('customer_points_balance')
      .select('confirmed_balance')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer.id)
      .maybeSingle();
    confirmedPoints = balance?.confirmed_balance ?? 0;
  }

  return (
    <AccountDashboard
      tenant={{
        name:             tenant.name,
        logoUrl:          tenant.logo_url,
        countriesServed:  tenant.countries_served,
        loyaltyEnabled:   tenant.loyalty_enabled,
        country:          tenant.country,
      }}
      email={customer.email}
      fullName={profile?.fullName ?? customer.full_name}
      phone={profile?.phone ?? null}
      confirmedPoints={confirmedPoints}
      addresses={(addresses ?? []) as Address[]}
      isAmbassador={ambassadorRow?.is_ambassador ?? false}
      ambassadorProfileCompleted={!!ambassadorRow?.ambassador_profile_completed_at}
    />
  );
}
