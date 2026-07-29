import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { redeemPoints, InsufficientPointsError } from '@/lib/loyalty/redeemPoints';

export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const body = await req.json() as { pointsToRedeem?: number; orderId?: string };
  const pointsToRedeem = body.pointsToRedeem;

  if (!pointsToRedeem || typeof pointsToRedeem !== 'number' || pointsToRedeem <= 0) {
    return NextResponse.json({ error: 'Nombre de points invalide.' }, { status: 400 });
  }

  try {
    const result = await redeemPoints({
      tenantId: tenant.id,
      customerId: customer.id,
      pointsToRedeem,
      orderId: body.orderId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof InsufficientPointsError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[api/loyalty/redeem] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
}
