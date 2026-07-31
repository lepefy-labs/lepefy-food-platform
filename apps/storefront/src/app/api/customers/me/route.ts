import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { getCustomerProfile } from '@/lib/customers/getCustomerProfile';

// GET /api/customers/me
// → 401 se non autenticato (parcours guest : le checkout ne l'appelle jamais)
// → { fullName, phone, email, defaultAddress: Address | null }
export async function GET() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const sessionCustomer = await getSessionCustomer(tenant.id);
  if (!sessionCustomer) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const profile = await getCustomerProfile(sessionCustomer.id, tenant.id);
  if (!profile) {
    return NextResponse.json({ error: 'Profil introuvable.' }, { status: 404 });
  }

  return NextResponse.json(profile);
}
