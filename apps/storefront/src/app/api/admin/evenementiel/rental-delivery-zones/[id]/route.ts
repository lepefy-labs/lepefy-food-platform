import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

const EDITABLE_FIELDS = [
  'label', 'postal_code_prefixes', 'city', 'country', 'fee_amount', 'note', 'active', 'sort_order',
] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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

  if (typeof patch.country === 'string') patch.country = patch.country.trim().toUpperCase() || null;
  if (Array.isArray(patch.postal_code_prefixes)) {
    const prefixes = (patch.postal_code_prefixes as unknown[]).map((p) => String(p).trim()).filter(Boolean);
    patch.postal_code_prefixes = prefixes.length ? prefixes : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour.' }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('rental_delivery_zones')
    .update(patch)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('rental_delivery_zones')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
