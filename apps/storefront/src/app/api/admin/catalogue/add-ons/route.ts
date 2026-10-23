import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/adminRbac';
import { addOnWarnings, isMissingAddOnColumn, MAX_ADD_ONS, parseAddOnIds, type AddOnAdminProduct } from '@/lib/catalog/addOns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SELECT = 'id, name, price, stock, active, weight_grams, min_order_quantity, image_url, add_on_position';

async function context(permission: 'catalog.view' | 'catalog.manage') {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return { tenant, denied: await requirePermission(tenant.id, permission), db: createServiceClient() };
}

async function readList(db: ReturnType<typeof createServiceClient>, tenantId: string) {
  const { data, error } = await db.from('products').select(SELECT)
    .eq('tenant_id', tenantId).not('add_on_position', 'is', null).order('add_on_position');
  if (isMissingAddOnColumn(error)) return { available: false as const, products: [] };
  if (error) throw error;
  const products = ((data ?? []) as unknown as Array<AddOnAdminProduct & { image_url: string | null }>)
    .map((product) => ({ ...product, warnings: addOnWarnings(product) }));
  return { available: true as const, products };
}

/** GET /api/admin/catalogue/add-ons — la liste « Petits plus » dans l'ordre (catalog.view). */
export async function GET() {
  const { tenant, denied, db } = await context('catalog.view');
  if (denied) return denied;
  try {
    return NextResponse.json({ ...(await readList(db, tenant.id)), max: MAX_ADD_ONS });
  } catch {
    return NextResponse.json({ error: 'Impossible de charger les petits plus.' }, { status: 500 });
  }
}

/** PUT { productIds } — remplace toute la liste, dans cet ordre (catalog.manage). */
export async function PUT(req: NextRequest) {
  const { tenant, denied, db } = await context('catalog.manage');
  if (denied) return denied;
  const body = await req.json().catch(() => null) as { productIds?: unknown } | null;
  const ids = parseAddOnIds(body?.productIds);
  if (!ids) return NextResponse.json({ error: `Liste invalide (${MAX_ADD_ONS} produits au plus).` }, { status: 400 });
  const { error } = await db.rpc('set_product_add_ons', { p_tenant_id: tenant.id, p_product_ids: ids });
  if (error) {
    if (/set_product_add_ons/.test(error.message) || error.code === 'PGRST202') {
      return NextResponse.json({ error: 'Fonction indisponible : la migration 165 n’est pas encore appliquée.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Impossible d’enregistrer la liste.' }, { status: 500 });
  }
  try {
    return NextResponse.json({ ...(await readList(db, tenant.id)), max: MAX_ADD_ONS });
  } catch {
    return NextResponse.json({ error: 'Liste enregistrée, rechargez la page.' }, { status: 200 });
  }
}
