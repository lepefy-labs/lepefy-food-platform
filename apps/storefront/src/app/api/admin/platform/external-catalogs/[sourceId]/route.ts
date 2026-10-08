import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSourceWithItems, updateSource } from '@/lib/externalCatalog/server/repository';
import { guardPlatformOwner, invalid, respond } from '@/lib/externalCatalog/server/routeGuard';
import { updateSourceSchema } from '@/lib/externalCatalog/server/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

export async function GET(req: NextRequest, { params }: { params: { sourceId: string } }) {
  const guard = await guardPlatformOwner(req, false);
  if (guard instanceof NextResponse) return guard;
  if (!idSchema.safeParse(params.sourceId).success) return invalid();
  return respond(await getSourceWithItems(params.sourceId, req.nextUrl.searchParams.get('status')));
}

export async function PATCH(req: NextRequest, { params }: { params: { sourceId: string } }) {
  const guard = await guardPlatformOwner(req, true);
  if (guard instanceof NextResponse) return guard;
  if (!idSchema.safeParse(params.sourceId).success) return invalid();
  const parsed = updateSourceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const consent = parsed.error.issues.some((i) => i.message === 'consent_note_required');
    return invalid(consent ? 'Décrivez le consentement obtenu (qui, quand, sous quelle forme).' : 'Paramètres invalides.');
  }
  return respond(await updateSource(params.sourceId, parsed.data, guard.actor));
}
