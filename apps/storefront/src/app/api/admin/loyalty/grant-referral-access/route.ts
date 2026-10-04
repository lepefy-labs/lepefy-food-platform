import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { grantReferralAccess } from '@/lib/loyalty/grantReferralAccess';

export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { customerId?: string };
  if (!body.customerId) {
    return NextResponse.json({ error: 'customerId requis.' }, { status: 400 });
  }

  const adminId = await getAdminId();

  const result = await grantReferralAccess({
    tenantId: tenant.id,
    customerId: body.customerId,
    reason: 'ADMIN_GRANTED',
    grantedByAdminId: adminId ?? undefined,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === 'not_found' ? 'Client introuvable.' : 'Mise à jour impossible. Réessayez.' },
      { status: result.reason === 'not_found' ? 404 : 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
