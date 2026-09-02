import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

async function authorizedRelationship(
  productId: string,
  relationshipId: string,
) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return { tenant, denied, supabase: null, relationship: null };

  const supabase = createServiceClient();
  const { data: relationship } = await supabase
    .from('product_relationships')
    .select('id')
    .eq('id', relationshipId)
    .eq('tenant_id', tenant.id)
    .eq('source_product_id', productId)
    .maybeSingle();

  return { tenant, denied: null, supabase, relationship };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; relationshipId: string } },
) {
  const context = await authorizedRelationship(params.id, params.relationshipId);
  if (context.denied) return context.denied;
  if (!context.relationship || !context.supabase) {
    return NextResponse.json({ error: 'Relation introuvable.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const payload: { priority?: number; active?: boolean } = {};
  if (Number.isInteger(body?.priority)) payload.priority = Math.max(0, Math.min(9999, body.priority));
  if (typeof body?.active === 'boolean') payload.active = body.active;
  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: 'Aucune modification valide.' }, { status: 400 });
  }

  const { error } = await context.supabase
    .from('product_relationships')
    .update(payload)
    .eq('id', params.relationshipId)
    .eq('tenant_id', context.tenant.id)
    .eq('source_product_id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; relationshipId: string } },
) {
  const context = await authorizedRelationship(params.id, params.relationshipId);
  if (context.denied) return context.denied;
  if (!context.relationship || !context.supabase) {
    return NextResponse.json({ error: 'Relation introuvable.' }, { status: 404 });
  }

  const { error } = await context.supabase
    .from('product_relationships')
    .delete()
    .eq('id', params.relationshipId)
    .eq('tenant_id', context.tenant.id)
    .eq('source_product_id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
