import { NextRequest } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { clientIp, createMemoryRateLimiter } from '@/lib/http/memoryRateLimit';
import { isAppEvent, isAppSource } from '@/lib/pwa/appInstall';

export const dynamic = 'force-dynamic';

const allow = createMemoryRateLimiter({ limit: 30, windowMs: 60_000 });
const done = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST /api/app/event { event, source } — +1 au compteur agrégé de
 * l'application installable (record_storefront_app_event, 186). Toujours 204 :
 * une mesure ne renvoie jamais d'erreur au navigateur, une migration absente
 * ne casse rien.
 */
export async function POST(req: NextRequest) {
  if (!allow(clientIp(req.headers))) return done();
  try {
    const body = await req.json().catch(() => null) as { event?: unknown; source?: unknown } | null;
    if (!isAppEvent(body?.event) || !isAppSource(body?.source)) return done();
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    await createServiceClient().rpc('record_storefront_app_event', { p_tenant_id: tenant.id, p_event: body.event, p_source: body.source });
  } catch {
    // Mesure facultative.
  }
  return done();
}
