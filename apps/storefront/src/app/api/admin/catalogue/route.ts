import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export async function POST(req: NextRequest) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const body     = await req.json();
  const supabase = createServiceClient();

  const slugProd = (body.name as string)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  const { data, error } = await supabase
    .from('products')
    .insert({
      tenant_id:          tenant.id,
      name:               String(body.name ?? '').trim(),
      slug:               slugProd,
      description:        body.description || null,
      price:              parseFloat(body.price) || 0,
      weight_grams:       body.weight_grams ? parseInt(body.weight_grams, 10) : null,
      stock:              parseInt(body.stock, 10) || 0,
      active:             Boolean(body.active),
      featured:           Boolean(body.featured),
      storage_type:       body.storage_type ?? 'dry',
      category_id:        body.category_id,
      warehouse_location: body.warehouse_location || null,
      position:           9999,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
