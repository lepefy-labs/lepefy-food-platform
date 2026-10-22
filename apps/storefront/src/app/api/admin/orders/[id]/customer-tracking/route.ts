import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { buildOrderTrackingLink } from '@/lib/orders/convertCheckoutSessionToOrder';
import { shopBaseUrl } from '@/lib/orders/assisted/assistedOrderServer';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/orders/[id]/customer-tracking → 302 to the signed page the
 * customer sees (/orders/[id]?token=). The token is built here, server-side,
 * so the order list never carries signed links in its payload.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'orders.view');
  if (denied) return denied;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  const { data: order } = await createServiceClient()
    .from('orders').select('id, email').eq('tenant_id', tenant.id).eq('id', params.id.toLowerCase()).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  const link = buildOrderTrackingLink(order.id, order.email, shopBaseUrl(tenant));
  if (!link) return NextResponse.json({ error: 'Lien de suivi client indisponible.' }, { status: 503 });
  return NextResponse.redirect(link, 302);
}
