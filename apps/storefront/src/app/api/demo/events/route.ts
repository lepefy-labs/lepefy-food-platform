/**
 * POST /api/demo/events — compteur agrégé (jour × évènement) de la démo.
 * Aucune donnée personnelle : seulement une clé de la liste DEMO_EVENT_KEYS.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isDemoDeployment } from '@/lib/demo/demoEnvironment';
import { countDemoEvent, demoBucket, demoRateAllowed, isDemoEventKey } from '@/lib/demo/server/demoServices';
import { clientIp } from '@/lib/http/memoryRateLimit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isDemoDeployment()) return new NextResponse(null, { status: 404 });
  const body = await request.json().catch(() => null) as { event?: unknown } | null;
  if (!isDemoEventKey(body?.event)) return new NextResponse(null, { status: 400 });
  if (await demoRateAllowed(demoBucket('events', clientIp(request.headers)), 120, 3600)) await countDemoEvent(body.event);
  return new NextResponse(null, { status: 204 });
}
