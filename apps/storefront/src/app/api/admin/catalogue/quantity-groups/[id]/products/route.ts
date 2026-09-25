import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';

export const runtime = 'nodejs';

// Un produit ne peut appartenir qu'à un seul groupe *actif* à la fois — la
// contrainte n'est pas exprimable en SQL partiel (elle traverse une jointure,
// cf. migration 121), donc elle est vérifiée ici avant l'insertion.
async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { product_id?: string };
  const productId = body.product_id;
  if (!productId) return NextResponse.json({ error: 'product_id requis.' }, { status: 400 });

  const supabase = createServiceClient();

  const { data: group } = await supabase
    .from('purchase_quantity_groups')
    .select('id')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!group) return NextResponse.json({ error: 'Groupe introuvable.' }, { status: 404 });

  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!product) return NextResponse.json({ error: 'Produit introuvable.' }, { status: 404 });

  const { data: existingMembership } = await supabase
    .from('purchase_quantity_group_products')
    .select('group_id, purchase_quantity_groups!inner(id, name, active, tenant_id)')
    .eq('product_id', productId)
    .eq('purchase_quantity_groups.tenant_id', tenant.id)
    .eq('purchase_quantity_groups.active', true);

  const conflicting = (existingMembership ?? []).find((row) => row.group_id !== params.id);
  if (conflicting) {
    return NextResponse.json({
      error: `Ce produit appartient déjà à un autre groupe actif (${(conflicting.purchase_quantity_groups as unknown as { name: string }).name}).`,
    }, { status: 409 });
  }

  const { error } = await supabase
    .from('purchase_quantity_group_products')
    .upsert({ group_id: params.id, product_id: productId }, { onConflict: 'group_id,product_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true }, { status: 201 });
}

async function handleDELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const productId = req.nextUrl.searchParams.get('product_id');
  if (!productId) return NextResponse.json({ error: 'product_id requis.' }, { status: 400 });

  const supabase = createServiceClient();

  const { data: group } = await supabase
    .from('purchase_quantity_groups')
    .select('id')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!group) return NextResponse.json({ error: 'Groupe introuvable.' }, { status: 404 });

  const { error } = await supabase
    .from('purchase_quantity_group_products')
    .delete()
    .eq('group_id', params.id)
    .eq('product_id', productId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export const POST = withStorefrontInvalidation(['catalog'], handlePOST);
export const DELETE = withStorefrontInvalidation(['catalog'], handleDELETE);
