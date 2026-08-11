import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getStuckSignupBonuses } from '@/lib/loyalty/getStuckSignupBonuses';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const items = await getStuckSignupBonuses(tenant.id);

  return NextResponse.json({ items });
}
