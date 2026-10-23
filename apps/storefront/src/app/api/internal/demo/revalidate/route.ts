/**
 * POST /api/internal/demo/revalidate — appelé par scripts/demo/seed-demo.mjs
 * après une réinitialisation : le tenant de démo a changé d'id, toutes les
 * pages et données en cache sont invalidées. Bearer DEMO_INTERNAL_TOKEN,
 * déploiement de démo uniquement.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isDemoDeployment } from '@/lib/demo/demoEnvironment';
import { schedulerBearerAuthorized } from '@/lib/shipping/shippingSyncAuth';
import { revalidateCatalogCache, revalidateReviewsCache, revalidateShopShellCache, revalidateTenantCache } from '@/lib/cache/storefrontCache';
import { getTenant } from '@/lib/tenant/getTenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!isDemoDeployment()) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
  if (!schedulerBearerAuthorized(request.headers.get('authorization'), process.env.DEMO_INTERNAL_TOKEN, undefined)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  revalidateTenantCache();
  revalidateReviewsCache();
  // Le tenant est relu après l'invalidation : les étiquettes catalogue et vitrine portent son nouvel id.
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? '').catch(() => null);
  if (tenant) {
    revalidateCatalogCache(tenant.id);
    revalidateShopShellCache(tenant.id);
  }
  return NextResponse.json({ ok: true, tenantId: tenant?.id ?? null }, { headers });
}
