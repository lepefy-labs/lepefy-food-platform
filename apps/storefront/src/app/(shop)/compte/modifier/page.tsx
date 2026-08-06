import { redirect } from 'next/navigation';
import { getCountries, type CountryCode } from 'libphonenumber-js';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { getCustomerProfile } from '@/lib/customers/getCustomerProfile';
import { ModifierProfilClient } from './ModifierProfilClient';

// Repli neutre (jamais une décision de branding) pour les rares cas où
// tenant.country ne serait pas un code ISO-2 exploitable par
// libphonenumber-js — la colonne `tenants.country` est `text` en base sans
// contrainte CHECK (défaut 'IT'), donc une valeur corrompue ne peut pas être
// exclue par le typage seul. Même logique que AccountDashboard.tsx avant sa
// migration vers cette page.
const FALLBACK_COUNTRY: CountryCode = 'FR';
const SUPPORTED_COUNTRY_CODES = new Set<string>(getCountries());

function normalizeCountryCode(raw: string): CountryCode {
  const upper = raw.trim().toUpperCase();
  return SUPPORTED_COUNTRY_CODES.has(upper) ? (upper as CountryCode) : FALLBACK_COUNTRY;
}

// Page pleine (pas de modale) — même garde de session que /compte.
export const dynamic = 'force-dynamic';

export default async function ModifierProfilPage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) redirect('/compte/connexion');

  const profile = await getCustomerProfile(customer.id, tenant.id);

  return (
    <ModifierProfilClient
      fullName={profile?.fullName ?? customer.full_name}
      phone={profile?.phone ?? null}
      defaultCountry={normalizeCountryCode(tenant.country)}
    />
  );
}
