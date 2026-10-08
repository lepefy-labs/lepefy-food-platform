import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { refreshSource } from '@/lib/externalCatalog/server/repository';
import { guardPlatformOwner, invalid, respond } from '@/lib/externalCatalog/server/routeGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Lecture du catalogue WhatsApp via GREEN-API, par blocs d'au plus 40 s.
 * Corps optionnel `{ resume, startedAt }` : reprise du bloc précédent (validée côté serveur).
 */
export async function POST(req: NextRequest, { params }: { params: { sourceId: string } }) {
  const guard = await guardPlatformOwner(req, true);
  if (guard instanceof NextResponse) return guard;
  if (!z.string().uuid().safeParse(params.sourceId).success) return invalid();
  const body = (await req.json().catch(() => ({}))) as { resume?: unknown; startedAt?: unknown } | null;
  return respond(await refreshSource(params.sourceId, guard.actor, { resume: body?.resume, startedAt: body?.startedAt }));
}
