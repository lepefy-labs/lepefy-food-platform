/**
 * POST /api/internal/catalog-schedule
 *
 * Tick programmé par n8n toutes les 5 minutes (credential bearer dédié
 * CATALOG_SCHEDULE_SCHEDULER_TOKEN ; jamais la clé service-role). Applique en
 * base les débuts et fins de promotions programmées et la fin des nouveautés
 * pour tous les tenants (migration 156), puis invalide le cache du tenant de
 * ce déploiement s'il est concerné (les autres déploiements : TTL ≤ 5 min).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { schedulerBearerAuthorized } from '@/lib/shipping/shippingSyncAuth';
import { summarizeCatalogSchedule, type CatalogScheduleChange } from '@/lib/catalog/catalogScheduleTick';
import { revalidateCatalogCache } from '@/lib/cache/storefrontCache';
import { getTenant } from '@/lib/tenant/getTenant';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  // Jeton dédié uniquement : pas de repli sur la clé service-role pour ce tick.
  if (!schedulerBearerAuthorized(request.headers.get('authorization'), process.env.CATALOG_SCHEDULE_SCHEDULER_TOKEN, undefined)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  try {
    // Journal d'activité : les changements de prix sont attribués à ce job.
    const service = createServiceClient({ auditActor: { actorType: 'automation', ref: 'catalog-schedule', source: 'worker' } });
    const { data, error } = await service.rpc('apply_product_promotion_schedule');
    if (error) throw error;
    const summary = summarizeCatalogSchedule((data ?? []) as CatalogScheduleChange[]);
    if (summary.tenantIds.length > 0) {
      const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood').catch(() => null);
      if (tenant && summary.tenantIds.includes(tenant.id)) revalidateCatalogCache(tenant.id);
    }
    return NextResponse.json({
      ok: true,
      started: summary.started,
      ended: summary.ended,
      expired: summary.expired,
      noveltiesEnded: summary.noveltiesEnded,
      tenants: summary.tenantIds.length,
    }, { headers });
  } catch {
    console.error('[catalog-schedule] tick unavailable');
    return NextResponse.json({ error: 'catalog_schedule_unavailable' }, { status: 503, headers });
  }
}
