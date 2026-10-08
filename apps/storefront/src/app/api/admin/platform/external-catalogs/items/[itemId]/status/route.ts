import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { setItemStatus } from '@/lib/externalCatalog/server/repository';
import { guardPlatformOwner, invalid, respond } from '@/lib/externalCatalog/server/routeGuard';
import { itemStatusSchema } from '@/lib/externalCatalog/server/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { itemId: string } }) {
  const guard = await guardPlatformOwner(req, true);
  if (guard instanceof NextResponse) return guard;
  if (!z.string().uuid().safeParse(params.itemId).success) return invalid();
  const parsed = itemStatusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid();
  return respond(await setItemStatus(params.itemId, parsed.data.action, guard.actor));
}
