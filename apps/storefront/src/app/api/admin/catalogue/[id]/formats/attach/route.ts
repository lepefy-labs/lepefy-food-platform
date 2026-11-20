import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/adminRbac';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { parseAttachSaleFormatBody, saleFormatRpcError } from '@/lib/catalog/saleFormatsAdmin';
import { readSaleFormats } from '@/lib/catalog/saleFormatsAdminServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST { productId, label, units_per_sale, stock_mode, baseLabel } — rattache
 * un produit existant comme format de cette fiche (catalog.manage). RPC 188
 * `attach_product_as_sale_format` : même id, prix, promotions, paniers et
 * commandes ; stock propre par défaut.
 */
async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'catalog.manage');
  if (denied) return denied;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Produit introuvable.' }, { status: 404 });
  const parsed = parseAttachSaleFormatBody(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const db = createServiceClient();
  const { error } = await db.rpc('attach_product_as_sale_format', {
    p_tenant_id: tenant.id,
    p_parent_id: params.id,
    p_product_id: parsed.body.productId,
    p_label: parsed.body.label,
    p_units: parsed.body.units_per_sale,
    p_stock_mode: parsed.body.stock_mode,
    p_base_label: parsed.body.baseLabel || null,
  });
  if (error) {
    const mapped = saleFormatRpcError(error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  try {
    return NextResponse.json(await readSaleFormats(db, tenant.id, params.id));
  } catch {
    return NextResponse.json({ error: 'Produit rattaché, rechargez la page.' }, { status: 200 });
  }
}

export const POST = withStorefrontInvalidation(['catalog'], handlePOST);
