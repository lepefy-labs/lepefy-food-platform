import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { getCustomerProfile } from '@/lib/customers/getCustomerProfile';
import { AdresseFormClient } from '../AdresseFormClient';

// Page pleine (pas de modale) — même garde de session que /compte.
export const dynamic = 'force-dynamic';

export default async function NouvelleAdressePage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) redirect('/compte/connexion');

  const profile = await getCustomerProfile(customer.id, tenant.id);

  return (
    <AdresseFormClient
      defaultFullName={profile?.fullName ?? customer.full_name}
      defaultCountry={tenant.country}
    />
  );
}
