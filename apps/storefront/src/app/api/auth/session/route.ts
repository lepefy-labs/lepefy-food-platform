import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';

export async function GET() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant      = await getTenant(tenantSlug);
  const customer    = await getSessionCustomer(tenant.id);

  return NextResponse.json({
    authenticated: !!customer,
    customer,
  });
}
