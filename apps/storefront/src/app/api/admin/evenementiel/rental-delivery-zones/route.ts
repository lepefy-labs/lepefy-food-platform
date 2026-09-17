import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

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

  const body = await req.json() as Record<string, unknown>;
  const label     = String(body.label ?? '').trim();
  const feeAmount = Number(body.fee_amount);
  const prefixes  = Array.isArray(body.postal_code_prefixes)
    ? (body.postal_code_prefixes as unknown[]).map((p) => String(p).trim()).filter(Boolean)
    : null;

  if (!label || !Number.isFinite(feeAmount) || feeAmount < 0) {
    return NextResponse.json({ error: 'Label et montant valides requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: last } = await supabase
    .from('rental_delivery_zones')
    .select('sort_order')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('rental_delivery_zones')
    .insert({
      tenant_id:            tenant.id,
      label,
      postal_code_prefixes: prefixes?.length ? prefixes : null,
      city:                 body.city ? String(body.city).trim() : null,
      country:              body.country ? String(body.country).trim().toUpperCase() : null,
      fee_amount:           feeAmount,
      note:                 body.note ? String(body.note).trim() : null,
      active:               body.active === undefined ? true : Boolean(body.active),
      sort_order:           nextSortOrder,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
