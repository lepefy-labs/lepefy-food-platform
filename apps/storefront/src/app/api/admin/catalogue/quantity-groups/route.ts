import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

// Gruppi di quantità combinabile (migration 121_purchase_quantity_rules.sql) —
// même principe de permission que /api/admin/catalogue (catalog.view/manage,
// résolu automatiquement par le préfixe /api/admin/catalogue/*).

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('purchase_quantity_groups')
    .select('id, name, min_quantity, quantity_step, active, purchase_quantity_group_products(product_id, products(id, name))')
    .eq('tenant_id', tenant.id)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const groups = (data ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    min_quantity: group.min_quantity,
    quantity_step: group.quantity_step,
    active: group.active,
    products: (group.purchase_quantity_group_products as unknown as Array<{ product_id: string; products: { id: string; name: string } | null }>)
      .filter((row) => row.products)
      .map((row) => ({ id: row.products!.id, name: row.products!.name })),
  }));

  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { name?: string; min_quantity?: number; quantity_step?: number };
  const name = String(body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Nom requis.' }, { status: 400 });

  if (![Number(body.min_quantity ?? 1), Number(body.quantity_step ?? 1)].every((value) => Number.isInteger(value) && value >= 1)) {
    return NextResponse.json({ error: 'Minimum et incrément doivent être des entiers positifs.' }, { status: 400 });
  }
  const minQuantity = Number(body.min_quantity ?? 1);
  const quantityStep = Number(body.quantity_step ?? 1);

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('purchase_quantity_groups')
    .insert({ tenant_id: tenant.id, name, min_quantity: minQuantity, quantity_step: quantityStep })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
