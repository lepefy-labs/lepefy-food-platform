import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  isProductRelationshipType,
  validateProductRelationshipProducts,
} from '@/lib/catalog/productRelationships';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function adminContext() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  return { tenant, denied, supabase: createServiceClient() };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { tenant, denied, supabase } = await adminContext();
  if (denied) return denied;
  if (!UUID_PATTERN.test(params.id)) {
    return NextResponse.json({ error: 'Produit invalide.' }, { status: 400 });
  }

  const { data: sourceProduct } = await supabase
    .from('products')
    .select('id')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!sourceProduct) {
    return NextResponse.json({ error: 'Produit introuvable.' }, { status: 404 });
  }

  const { data: relationships, error } = await supabase
    .from('product_relationships')
    .select('id, target_product_id, relationship_type, priority, active, source, created_at')
    .eq('tenant_id', tenant.id)
    .eq('source_product_id', params.id)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const targetIds = [...new Set((relationships ?? []).map((item) => item.target_product_id))];
  const { data: products, error: productsError } = targetIds.length
    ? await supabase
        .from('products')
        .select('id, name, slug, image_url, stock, active, category:categories(name)')
        .eq('tenant_id', tenant.id)
        .in('id', targetIds)
    : { data: [], error: null };

  if (productsError) return NextResponse.json({ error: productsError.message }, { status: 500 });
  const productById = new Map((products ?? []).map((product) => [product.id, product]));

  return NextResponse.json({
    relationships: (relationships ?? []).flatMap((relationship) => {
      const product = productById.get(relationship.target_product_id);
      return product ? [{ ...relationship, product }] : [];
    }),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { tenant, denied, supabase } = await adminContext();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const targetProductId = typeof body?.targetProductId === 'string' ? body.targetProductId : '';
  const relationshipType = body?.relationshipType;
  const priority = Number.isInteger(body?.priority) ? Math.max(0, Math.min(9999, body.priority)) : 0;

  if (
    !UUID_PATTERN.test(params.id)
    || !UUID_PATTERN.test(targetProductId)
    || !isProductRelationshipType(relationshipType)
  ) {
    return NextResponse.json({ error: 'Relation invalide.' }, { status: 400 });
  }

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, tenant_id')
    .in('id', [params.id, targetProductId]);

  if (productsError) return NextResponse.json({ error: productsError.message }, { status: 500 });
  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const validation = validateProductRelationshipProducts({
    tenantId: tenant.id,
    sourceProductId: params.id,
    targetProductId,
    sourceTenantId: productById.get(params.id)?.tenant_id,
    targetTenantId: productById.get(targetProductId)?.tenant_id,
    relationshipType,
  });

  if (!validation.valid) {
    const messages = {
      invalid_type: 'Type de relation invalide.',
      self_relation: 'Un produit ne peut pas être associé à lui-même.',
      wrong_tenant: 'Les deux produits doivent appartenir à la même boutique.',
      product_not_found: 'Produit source ou cible introuvable.',
    };
    return NextResponse.json({ error: messages[validation.reason] }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('product_relationships')
    .insert({
      tenant_id: tenant.id,
      source_product_id: params.id,
      target_product_id: targetProductId,
      relationship_type: relationshipType,
      priority,
      active: true,
      source: 'manual',
    })
    .select('id')
    .single();

  if (error?.code === '23505') {
    return NextResponse.json(
      { error: 'Ce produit est déjà présent dans ce groupe.' },
      { status: 409 },
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
