import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getItemDetail } from '@/lib/externalCatalog/server/repository';
import { guardPlatformOwner, invalid, respond } from '@/lib/externalCatalog/server/routeGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { itemId: string } }) {
  const guard = await guardPlatformOwner(req, false);
  if (guard instanceof NextResponse) return guard;
  if (!z.string().uuid().safeParse(params.itemId).success) return invalid();
  return respond(await getItemDetail(params.itemId));
}
