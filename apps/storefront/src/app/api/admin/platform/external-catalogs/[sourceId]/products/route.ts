import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { searchTenantProducts } from '@/lib/externalCatalog/server/repository';
import { guardPlatformOwner, invalid, respond } from '@/lib/externalCatalog/server/routeGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Produits du tenant cible de la source, pour lier un produit WhatsApp à un produit existant. */
export async function GET(req: NextRequest, { params }: { params: { sourceId: string } }) {
  const guard = await guardPlatformOwner(req, false);
  if (guard instanceof NextResponse) return guard;
  if (!z.string().uuid().safeParse(params.sourceId).success) return invalid();
  const { data: source } = await createServiceClient()
    .from('external_catalog_sources').select('tenant_id').eq('id', params.sourceId).maybeSingle();
  if (!source) return NextResponse.json({ error: 'Source introuvable.' }, { status: 404 });
  return respond(await searchTenantProducts(source.tenant_id as string, req.nextUrl.searchParams.get('q') ?? ''));
}
