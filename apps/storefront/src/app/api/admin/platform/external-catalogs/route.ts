import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createSource, listSources, listTenantOptions } from '@/lib/externalCatalog/server/repository';
import { guardPlatformOwner, invalid, respond } from '@/lib/externalCatalog/server/routeGuard';
import { createSourceSchema } from '@/lib/externalCatalog/server/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await guardPlatformOwner(req, false);
  if (guard instanceof NextResponse) return guard;
  const [sources, tenants] = await Promise.all([listSources(), listTenantOptions()]);
  if (!sources.ok) return respond(sources);
  return NextResponse.json({ sources: sources.data, tenants }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const guard = await guardPlatformOwner(req, true);
  if (guard instanceof NextResponse) return guard;
  const parsed = createSourceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid('Champs invalides : tenant, nom, lien wa.me/c/… et numéro du vendeur sont obligatoires.');
  return respond(await createSource(parsed.data, guard.actor), 201);
}
