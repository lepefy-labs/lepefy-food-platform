import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const name          = String(body.name ?? '').trim();
  const pricePerUnit  = Number(body.price_per_unit);
  const stockQuantity = Number(body.stock_quantity ?? 0);

  if (!name || !Number.isFinite(pricePerUnit) || pricePerUnit < 0 || !Number.isInteger(stockQuantity) || stockQuantity < 0) {
    return NextResponse.json({ error: 'Nom, prix et stock valides requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: offering } = await supabase
    .from('service_offerings')
    .select('id')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!offering) return NextResponse.json({ error: 'Service introuvable.' }, { status: 404 });

  const { data: last } = await supabase
    .from('rental_items')
    .select('sort_order')
    .eq('service_offering_id', offering.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('rental_items')
    .insert({
      tenant_id:            tenant.id,
      service_offering_id:  offering.id,
      name,
      category:             body.category ? String(body.category).trim() : null,
      price_per_unit:       pricePerUnit,
      stock_quantity:       stockQuantity,
      image_url:            body.image_url ? String(body.image_url) : null,
      active:               body.active === undefined ? true : Boolean(body.active),
      sort_order:           nextSortOrder,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
