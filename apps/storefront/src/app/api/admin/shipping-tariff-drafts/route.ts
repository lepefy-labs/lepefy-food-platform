import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import type { ShippingTariffBand } from '@lepefy/types';
import { validateMultiParcelStrategy } from '@/lib/shipping/intelligence/tariffBacktest';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
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

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('shipping_tariff_drafts')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const adminId = await getAdminId();
  const body = await req.json() as Record<string, unknown>;

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Brouillon sans titre';
  const bands = validateBands(body.bands);
  if (!bands) return NextResponse.json({ error: 'Bandes de poids invalides.' }, { status: 400 });

  const zoneSurcharges = (typeof body.zone_surcharges === 'object' && body.zone_surcharges !== null)
    ? body.zone_surcharges as Record<string, number>
    : {};
  const multiParcelStrategy = validateMultiParcelStrategy(body.multi_parcel_strategy);
  if (multiParcelStrategy === 'invalid') return NextResponse.json({ error: 'Stratégie multi-colis invalide.' }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('shipping_tariff_drafts')
    .insert({
      tenant_id: tenant.id,
      name,
      status: 'draft',
      bands,
      zone_surcharges: zoneSurcharges,
      multi_parcel_strategy: multiParcelStrategy,
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
      created_by: adminId,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
