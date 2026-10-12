import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { findDeliveryZoneConflict, normalizeDeliveryZone, type ExistingDeliveryZone } from '@/lib/rental/deliveryZoneRules';

const EDITABLE_FIELDS = [
  'label', 'kind', 'postal_code_prefixes', 'city', 'country', 'fee_amount', 'note', 'active',
] as const;

// La zone modifiée est contrôlée en entier (ligne existante + modifications),
// avec les mêmes règles que la création.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour.' }, { status: 400 });
  }
  const sortOrder = Number.isInteger(body.sort_order) ? body.sort_order as number : undefined;
  if (!EDITABLE_FIELDS.some((field) => body[field] !== undefined) && sortOrder === undefined) {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: zones, error: zonesError } = await supabase
    .from('rental_delivery_zones')
    .select('id, label, country, city, postal_code_prefixes, fee_amount, note, active')
    .eq('tenant_id', tenant.id);
  if (zonesError) return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });

  const current = (zones ?? []).find((zone) => zone.id === params.id);
  if (!current) return NextResponse.json({ error: 'Zone introuvable.' }, { status: 404 });

  const merged: Record<string, unknown> = { ...current };
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) merged[field] = body[field];
  }
  const normalized = normalizeDeliveryZone(merged);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error, field: normalized.field }, { status: 400 });
  }

  const conflict = findDeliveryZoneConflict(normalized.zone, (zones ?? []) as ExistingDeliveryZone[], params.id);
  if (conflict) return NextResponse.json({ error: conflict.error, field: conflict.field }, { status: 409 });

  const { data, error } = await supabase
    .from('rental_delivery_zones')
    .update({
      ...normalized.zone,
      ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
      updated_at: new Date().toISOString(),
    })
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
