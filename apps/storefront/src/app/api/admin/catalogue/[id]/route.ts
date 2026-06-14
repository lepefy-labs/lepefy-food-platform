import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const body   = await req.json() as Record<string, unknown>;

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('products')
    .update({
      name:               String(body.name ?? '').trim(),
      description:        body.description ? String(body.description).trim() : null,
      price:              parseFloat(String(body.price)) || 0,
      weight_grams:       body.weight_grams ? parseInt(String(body.weight_grams), 10) : null,
      stock:              parseInt(String(body.stock ?? 0), 10) || 0,
      active:             Boolean(body.active),
      featured:           Boolean(body.featured),
      storage_type:       body.storage_type ?? 'dry',
      category_id:        body.category_id,
      warehouse_location: body.warehouse_location
                            ? String(body.warehouse_location).trim()
                            : null,
    })
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
