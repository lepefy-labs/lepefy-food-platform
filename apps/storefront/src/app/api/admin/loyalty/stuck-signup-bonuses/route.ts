import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getStuckSignupBonuses } from '@/lib/loyalty/getStuckSignupBonuses';

export async function GET() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const items = await getStuckSignupBonuses(tenant.id);

  return NextResponse.json({ items });
}
