import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const updatePayload: Record<string, unknown> = {};

  if ('name' in body) {
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Nom requis.' }, { status: 400 });
    updatePayload.name = name;
  }
  if ('min_quantity' in body) updatePayload.min_quantity = Math.max(1, parseInt(String(body.min_quantity ?? 1), 10) || 1);
  if ('quantity_step' in body) updatePayload.quantity_step = Math.max(1, parseInt(String(body.quantity_step ?? 1), 10) || 1);
  if ('active' in body) updatePayload.active = Boolean(body.active);

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('purchase_quantity_groups')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('purchase_quantity_groups')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
