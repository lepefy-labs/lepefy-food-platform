import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

const EDITABLE_FIELDS = [
  'name', 'category', 'price_per_unit', 'stock_quantity', 'image_url', 'active', 'sort_order',
] as const;

export async function PATCH(req: NextRequest, { params }: { params: { itemId: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body  = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    patch[field] = body[field];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('rental_items')
    .update(patch)
    .eq('id', params.itemId)
    .eq('tenant_id', tenant.id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { itemId: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { count } = await supabase
    .from('rental_reservation_items')
    .select('id', { count: 'exact', head: true })
    .eq('rental_item_id', params.itemId);

  if (count && count > 0) {
    const { data, error } = await supabase
      .from('rental_items')
      .update({ active: false })
      .eq('id', params.itemId)
      .eq('tenant_id', tenant.id)
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deactivated: true, rentalItem: data });
  }

  const { error } = await supabase
    .from('rental_items')
    .delete()
    .eq('id', params.itemId)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, deactivated: false });
}
