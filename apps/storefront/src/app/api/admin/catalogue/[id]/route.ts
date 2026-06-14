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

  const updatePayload: Record<string, unknown> = {};

  if ('name'               in body) updatePayload.name               = String(body.name).trim();
  if ('description'        in body) updatePayload.description        = body.description ? String(body.description).trim() : null;
  if ('price'              in body) updatePayload.price              = parseFloat(String(body.price)) || 0;
  if ('weight_grams'       in body) updatePayload.weight_grams       = body.weight_grams ? parseInt(String(body.weight_grams), 10) : null;
  if ('stock'              in body) updatePayload.stock              = parseInt(String(body.stock ?? 0), 10) || 0;
  if ('active'             in body) updatePayload.active             = Boolean(body.active);
  if ('featured'           in body) updatePayload.featured           = Boolean(body.featured);
  if ('storage_type'       in body) updatePayload.storage_type       = body.storage_type;
  if ('category_id'        in body) updatePayload.category_id        = body.category_id;
  if ('warehouse_location' in body) updatePayload.warehouse_location = body.warehouse_location ? String(body.warehouse_location).trim() : null;
  if ('image_url'          in body) updatePayload.image_url          = body.image_url ?? null;

  const { error } = await supabase
    .from('products')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
