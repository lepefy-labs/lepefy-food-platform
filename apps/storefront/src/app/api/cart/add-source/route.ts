import { NextRequest } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { clientIp, createMemoryRateLimiter } from '@/lib/http/memoryRateLimit';

export const dynamic = 'force-dynamic';

const PLACEMENTS = new Set(['cart_suggestions', 'cart_fits', 'add_confirmation']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allow = createMemoryRateLimiter({ limit: 60, windowMs: 60_000 });
const done = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST /api/cart/add-source { productId, placement } — +1 au compteur agrégé
 * (record_storefront_add, 165). Toujours 204 : une mesure ne renvoie jamais
 * d'erreur au navigateur, et une migration absente ne casse rien.
 */
export async function POST(req: NextRequest) {
  if (!allow(clientIp(req.headers))) return done();
  try {
    const body = await req.json().catch(() => null) as { productId?: unknown; placement?: unknown } | null;
    const productId = typeof body?.productId === 'string' ? body.productId : '';
    const placement = typeof body?.placement === 'string' ? body.placement : '';
    if (!UUID.test(productId) || !PLACEMENTS.has(placement)) return done();
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    await createServiceClient().rpc('record_storefront_add', { p_tenant_id: tenant.id, p_product_id: productId.toLowerCase(), p_placement: placement });
  } catch {
    // Mesure facultative.
  }
  return done();
}
