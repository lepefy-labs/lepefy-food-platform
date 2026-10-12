import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { findDeliveryZoneConflict, normalizeDeliveryZone, type ExistingDeliveryZone } from '@/lib/rental/deliveryZoneRules';

export async function GET() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('rental_delivery_zones')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const normalized = normalizeDeliveryZone(body ?? {});
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error, field: normalized.field }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: existing, error: existingError } = await supabase
    .from('rental_delivery_zones')
    .select('id, label, country, city, postal_code_prefixes, active, sort_order')
    .eq('tenant_id', tenant.id);
  if (existingError) return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });

  const conflict = findDeliveryZoneConflict(normalized.zone, (existing ?? []) as ExistingDeliveryZone[]);
  if (conflict) return NextResponse.json({ error: conflict.error, field: conflict.field }, { status: 409 });

  const nextSortOrder = (existing ?? []).reduce((max, zone) => Math.max(max, (zone.sort_order as number | null) ?? -1), -1) + 1;

  const { data, error } = await supabase
    .from('rental_delivery_zones')
    .insert({ tenant_id: tenant.id, ...normalized.zone, sort_order: nextSortOrder })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
