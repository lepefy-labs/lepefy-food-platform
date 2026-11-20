import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/adminRbac';
import type { AttachCandidate } from '@/lib/catalog/saleFormatsAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 20;

/**
 * GET /api/admin/catalogue/[id]/formats/candidates?q= — produits de la
 * boutique à rattacher comme format de cette fiche (catalog.view). Les
 * produits déjà formats ou ayant des formats sont renvoyés avec leur état :
 * l'éditeur explique pourquoi ils ne sont pas rattachables.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'catalog.view');
  if (denied) return denied;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Produit introuvable.' }, { status: 404 });
  // Caractères spéciaux de motif retirés : la recherche reste un « contient ».
  const q = (req.nextUrl.searchParams.get('q') ?? '').replace(/[%_,()\\*]/g, ' ').trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ candidates: [] });

  const db = createServiceClient();
  const { data, error } = await db.from('products')
    .select('id, name, slug, price, compare_at_price, stock, active, featured, min_order_quantity, order_quantity_step, add_on_position, image_url, format_parent_id')
    .eq('tenant_id', tenant.id)
    .neq('id', params.id)
    .ilike('name', `%${q}%`)
    .order('active', { ascending: false })
    .order('name')
    .limit(LIMIT);
  if (error) return NextResponse.json({ error: 'Recherche impossible.' }, { status: 500 });
  const rows = (data ?? []) as unknown as Array<Omit<AttachCandidate, 'has_formats'>>;
  const ids = rows.map((row) => row.id);
  let parents = new Set<string>();
  if (ids.length) {
    const { data: children, error: childrenError } = await db.from('products').select('format_parent_id')
      .eq('tenant_id', tenant.id).in('format_parent_id', ids);
    if (childrenError) return NextResponse.json({ error: 'Recherche impossible.' }, { status: 500 });
    parents = new Set(((children ?? []) as Array<{ format_parent_id: string }>).map((row) => row.format_parent_id));
  }
  const candidates: AttachCandidate[] = rows.map((row) => ({
    ...row,
    price: Number(row.price),
    compare_at_price: row.compare_at_price == null ? null : Number(row.compare_at_price),
    has_formats: parents.has(row.id),
  }));
  return NextResponse.json({ candidates });
}
