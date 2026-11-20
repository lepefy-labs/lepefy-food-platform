import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/adminRbac';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { saleFormatRpcError } from '@/lib/catalog/saleFormatsAdmin';
import { readSaleFormats } from '@/lib/catalog/saleFormatsAdminServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST { formatId } — détache un format à stock propre de cette fiche
 * (catalog.manage). RPC 188 `detach_product_sale_format` : le produit
 * redevient une fiche autonome (même id, stock, prix, adresse).
 */
async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'catalog.manage');
  if (denied) return denied;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Produit introuvable.' }, { status: 404 });
  const body = await req.json().catch(() => null) as { formatId?: unknown } | null;
  const formatId = typeof body?.formatId === 'string' && UUID.test(body.formatId) ? body.formatId : null;
  if (!formatId) return NextResponse.json({ error: 'Format introuvable.' }, { status: 400 });

  const db = createServiceClient();
  // Le format doit appartenir à CETTE fiche (l'URL), pas seulement au tenant.
  const { data: format, error: readError } = await db.from('products').select('id, format_parent_id')
    .eq('tenant_id', tenant.id).eq('id', formatId).maybeSingle();
  if (readError) {
    const mapped = saleFormatRpcError(readError.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  if (!format || format.format_parent_id !== params.id) {
    return NextResponse.json({ error: 'Ce format n’appartient plus à cette fiche. Rechargez la page.' }, { status: 409 });
  }

  const { error } = await db.rpc('detach_product_sale_format', { p_tenant_id: tenant.id, p_product_id: formatId });
  if (error) {
    const mapped = saleFormatRpcError(error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  try {
    return NextResponse.json(await readSaleFormats(db, tenant.id, params.id));
  } catch {
    return NextResponse.json({ error: 'Format détaché, rechargez la page.' }, { status: 200 });
  }
}

export const POST = withStorefrontInvalidation(['catalog'], handlePOST);
