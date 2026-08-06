import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { getCustomerProfile } from '@/lib/customers/getCustomerProfile';
import { createServiceClient } from '@/lib/supabase/server';
import type { Address } from '@lepefy/types';
import { AdresseFormClient } from '../AdresseFormClient';

// Page pleine (pas de modale) — même garde de session que /compte.
export const dynamic = 'force-dynamic';

export default async function ModifierAdressePage({ params }: { params: { id: string } }) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) redirect('/compte/connexion');

  const supabase = createServiceClient();

  // Jamais se fier au seul id de l'URL — scopé customer_id + tenant_id de la
  // session courante, même principe que PATCH/DELETE
  // /api/customers/me/addresses/[id]/route.ts.
  const { data: address } = await supabase
    .from('addresses')
    .select('*')
    .eq('id', params.id)
    .eq('customer_id', customer.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!address) redirect('/compte');

  const profile = await getCustomerProfile(customer.id, tenant.id);

  return (
    <AdresseFormClient
      address={address as Address}
      defaultFullName={profile?.fullName ?? customer.full_name}
      defaultCountry={tenant.country}
    />
  );
}
