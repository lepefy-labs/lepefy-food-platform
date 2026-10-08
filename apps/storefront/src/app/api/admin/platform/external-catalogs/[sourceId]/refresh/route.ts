import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { refreshSource } from '@/lib/externalCatalog/server/repository';
import { guardPlatformOwner, invalid, respond } from '@/lib/externalCatalog/server/routeGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Lecture du catalogue WhatsApp via GREEN-API (une requête, au maximum autorisé : 500 produits). */
export async function POST(req: NextRequest, { params }: { params: { sourceId: string } }) {
  const guard = await guardPlatformOwner(req, true);
  if (guard instanceof NextResponse) return guard;
  if (!z.string().uuid().safeParse(params.sourceId).success) return invalid();
  return respond(await refreshSource(params.sourceId, guard.actor));
}
