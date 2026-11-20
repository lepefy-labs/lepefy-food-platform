import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/adminRbac';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { nextAvailableSlug } from '@/lib/catalog/productDuplication';
import {
  parseSaleFormatsBody,
  saleFormatRpcError,
  saleFormatSlugBase,
} from '@/lib/catalog/saleFormatsAdmin';
import { readSaleFormats } from '@/lib/catalog/saleFormatsAdminServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type { AdminSaleFormatsResponse } from '@/lib/catalog/saleFormatsAdminServer';

async function context(permission: 'catalog.view' | 'catalog.manage') {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return { tenant, denied: await requirePermission(tenant.id, permission), db: createServiceClient() };
}

/** GET /api/admin/catalogue/[id]/formats — formats de vente d'une fiche (catalog.view). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { tenant, denied, db } = await context('catalog.view');
  if (denied) return denied;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Produit introuvable.' }, { status: 404 });
  try {
    const result = await readSaleFormats(db, tenant.id, params.id);
    if (!result) return NextResponse.json({ error: 'Produit introuvable, ou c’est lui-même un format.' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const mapped = saleFormatRpcError((error as { message?: string })?.message);
    return NextResponse.json({ error: mapped.status === 503 ? mapped.error : 'Impossible de charger les formats.' }, { status: mapped.status === 503 ? 503 : 500 });
  }
}

/**
 * PUT { baseLabel, formats[] } — remplace la liste complète, dans cet ordre
 * (catalog.manage). RPC atomique `set_product_sale_formats` ; un format retiré
 * est mis hors vente, jamais supprimé.
 */
async function handlePUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { tenant, denied, db } = await context('catalog.manage');
  if (denied) return denied;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Produit introuvable.' }, { status: 404 });
  const parsed = parseSaleFormatsBody(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data: parent, error: parentError } = await db.from('products').select('id, slug, format_parent_id')
    .eq('tenant_id', tenant.id).eq('id', params.id).maybeSingle();
  if (parentError) {
    const mapped = saleFormatRpcError(parentError.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  if (!parent || parent.format_parent_id) return NextResponse.json({ error: 'Produit introuvable, ou c’est lui-même un format.' }, { status: 404 });

  // Adresse des nouveaux formats : jamais une page à part (redirection vers la fiche), mais unique dans le tenant.
  const newFormats = parsed.body.formats.filter((format) => !format.id);
  const slugs = new Map<string, string>();
  if (newFormats.length) {
    const { data: taken } = await db.from('products').select('slug').eq('tenant_id', tenant.id).like('slug', `${parent.slug}-%`);
    const used = new Set(((taken ?? []) as Array<{ slug: string }>).map((row) => row.slug));
    for (const format of newFormats) {
      const slug = nextAvailableSlug(saleFormatSlugBase(parent.slug, format.label), used);
      used.add(slug);
      slugs.set(format.label, slug);
    }
  }

  const { error } = await db.rpc('set_product_sale_formats', {
    p_tenant_id: tenant.id,
    p_product_id: params.id,
    p_base_label: parsed.body.baseLabel,
    p_formats: parsed.body.formats.map((format) => ({
      ...(format.id ? { id: format.id } : { slug: slugs.get(format.label) }),
      label: format.label,
      units_per_sale: format.units_per_sale,
      price: format.price,
      weight_grams: format.weight_grams,
      active: format.active,
      stock_mode: format.stock_mode,
    })),
  });
  if (error) {
    const mapped = saleFormatRpcError(error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  try {
    return NextResponse.json(await readSaleFormats(db, tenant.id, params.id));
  } catch {
    return NextResponse.json({ error: 'Formats enregistrés, rechargez la page.' }, { status: 200 });
  }
}

export const PUT = withStorefrontInvalidation(['catalog'], handlePUT);
