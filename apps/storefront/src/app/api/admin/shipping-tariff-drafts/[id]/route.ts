import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { ShippingTariffBand } from '@lepefy/types';
import { validateMultiParcelStrategy } from '@/lib/shipping/intelligence/tariffBacktest';

export const runtime = 'nodejs';

function validateBands(raw: unknown): ShippingTariffBand[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const bands = raw.map((b) => ({
    minKg: Number((b as Record<string, unknown>).minKg),
    maxKg: (b as Record<string, unknown>).maxKg === null ? null : Number((b as Record<string, unknown>).maxKg),
    price: Number((b as Record<string, unknown>).price),
  }));
  if (bands.some((b) => !Number.isFinite(b.minKg) || b.minKg < 0 || !Number.isFinite(b.price) || b.price < 0)) return null;
  return bands;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const updatePayload: Record<string, unknown> = {};

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Nom requis.' }, { status: 400 });
    updatePayload.name = name;
  }
  if ('bands' in body) {
    const bands = validateBands(body.bands);
    if (!bands) return NextResponse.json({ error: 'Bandes de poids invalides.' }, { status: 400 });
    updatePayload.bands = bands;
  }
  if ('zone_surcharges' in body) {
    updatePayload.zone_surcharges = (typeof body.zone_surcharges === 'object' && body.zone_surcharges !== null)
      ? body.zone_surcharges : {};
  }
  if ('multi_parcel_strategy' in body) {
    const strategy = validateMultiParcelStrategy(body.multi_parcel_strategy);
    if (strategy === 'invalid') return NextResponse.json({ error: 'Stratégie multi-colis invalide.' }, { status: 400 });
    updatePayload.multi_parcel_strategy = strategy;
  }
  if ('notes' in body) updatePayload.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
  if ('status' in body && (body.status === 'draft' || body.status === 'archived')) updatePayload.status = body.status;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('shipping_tariff_drafts')
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
    .from('shipping_tariff_drafts')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
