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
  saleFormatWarnings,
} from '@/lib/catalog/saleFormatsAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASE_SELECT = 'id, name, slug, price, stock, min_order_quantity, order_quantity_step, weight_grams, format_label, format_parent_id, sale_unit, net_content_value, net_content_unit, pack_count, net_quantity_display';
const FORMAT_SELECT = 'id, name, slug, price, compare_at_price, promo_applied, promo_price, stock, active, weight_grams, format_label, units_per_sale, format_position, format_stock_mode, min_order_quantity, order_quantity_step';

export interface AdminSaleFormatsResponse {
  base: {
    id: string; name: string; slug: string; price: number; stock: number;
    min_order_quantity: number; order_quantity_step: number; weight_grams: number | null; format_label: string | null;
    sale_unit: string | null; net_content_value: number | null; net_content_unit: string | null; pack_count: number | null; net_quantity_display: string | null;
  };
  formats: Array<{
    id: string; name: string; slug: string; price: number; compare_at_price: number | null; promo_applied: boolean; promo_price: number | null;
    stock: number; active: boolean; weight_grams: number | null; format_label: string | null; units_per_sale: number;
    format_position: number; format_stock_mode: 'shared' | 'own'; min_order_quantity: number; order_quantity_step: number;
  }>;
  groups: Array<{ name: string; min_quantity: number }>;
  warnings: string[];
}

async function context(permission: 'catalog.view' | 'catalog.manage') {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return { tenant, denied: await requirePermission(tenant.id, permission), db: createServiceClient() };
}

async function readFormats(db: ReturnType<typeof createServiceClient>, tenantId: string, productId: string): Promise<AdminSaleFormatsResponse | null> {
  const { data: base, error } = await db.from('products').select(BASE_SELECT)
    .eq('tenant_id', tenantId).eq('id', productId).maybeSingle();
  if (error) throw error;
  if (!base || (base as { format_parent_id: string | null }).format_parent_id) return null;
  const { data: formats, error: formatsError } = await db.from('products').select(FORMAT_SELECT)
    .eq('tenant_id', tenantId).eq('format_parent_id', productId)
    .order('active', { ascending: false }).order('format_position').order('units_per_sale');
  if (formatsError) throw formatsError;
  const formatRows = (formats ?? []) as unknown as AdminSaleFormatsResponse['formats'];
  // Groupes à mélanger actifs de la fiche ou de ses formats : signalés, jamais désactivés.
  const memberIds = [productId, ...formatRows.map((row) => row.id)];
  const { data: memberships } = await db.from('purchase_quantity_group_products')
    .select('purchase_quantity_groups!inner(name, min_quantity, active, tenant_id)')
    .in('product_id', memberIds)
    .eq('purchase_quantity_groups.tenant_id', tenantId)
    .eq('purchase_quantity_groups.active', true);
  const groups = [...new Map(((memberships ?? []) as unknown as Array<{ purchase_quantity_groups: { name: string; min_quantity: number } }>)
    .map((row) => [row.purchase_quantity_groups.name, { name: row.purchase_quantity_groups.name, min_quantity: row.purchase_quantity_groups.min_quantity }])).values()];
  const typedBase = base as unknown as AdminSaleFormatsResponse['base'];
  return {
    base: typedBase,
    formats: formatRows,
    groups,
    warnings: saleFormatWarnings({
      base: typedBase,
      basePrice: Number(typedBase.price),
      formats: formatRows.map((row) => ({
        label: row.format_label ?? '', units_per_sale: row.units_per_sale, weight_grams: row.weight_grams, active: row.active, price: Number(row.price),
      })),
      groups,
    }),
  };
}

/** GET /api/admin/catalogue/[id]/formats — formats de vente d'une fiche (catalog.view). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { tenant, denied, db } = await context('catalog.view');
  if (denied) return denied;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Produit introuvable.' }, { status: 404 });
  try {
    const result = await readFormats(db, tenant.id, params.id);
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
    return NextResponse.json(await readFormats(db, tenant.id, params.id));
  } catch {
    return NextResponse.json({ error: 'Formats enregistrés, rechargez la page.' }, { status: 200 });
  }
}

export const PUT = withStorefrontInvalidation(['catalog'], handlePUT);
