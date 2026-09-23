import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { parseSuggestRange, parseTare } from '@/lib/shipping/cartonSuggestion';

export const runtime = 'nodejs';

function parsePositiveInt(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
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
  for (const [bodyKey, column] of [
    ['box_length_cm', 'box_length_cm'], ['box_width_cm', 'box_width_cm'],
    ['box_height_cm', 'box_height_cm'], ['max_weight_g', 'max_weight_g'],
  ] as const) {
    if (bodyKey in body) {
      const value = parsePositiveInt(body[bodyKey]);
      if (!value) return NextResponse.json({ error: 'Valeur invalide.' }, { status: 400 });
      updatePayload[column] = value;
    }
  }
  const suggestRange = parseSuggestRange(body);
  if (!suggestRange.ok) return NextResponse.json({ error: suggestRange.error }, { status: 400 });
  const tare = parseTare(body);
  if (!tare.ok) return NextResponse.json({ error: tare.error }, { status: 400 });
  Object.assign(updatePayload, suggestRange.patch, tare.patch);
  if ('active' in body) updatePayload.active = Boolean(body.active);
  if ('position' in body) updatePayload.position = parseInt(String(body.position), 10) || 0;

  const supabase = createServiceClient();

  if ('is_default' in body && Boolean(body.is_default)) {
    await supabase.from('shipping_packaging_profiles')
      .update({ is_default: false })
      .eq('tenant_id', tenant.id)
      .eq('is_default', true);
    updatePayload.is_default = true;
  } else if ('is_default' in body) {
    updatePayload.is_default = false;
  }

  const { error } = await supabase
    .from('shipping_packaging_profiles')
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

  const { data: profile } = await supabase
    .from('shipping_packaging_profiles')
    .select('is_default')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle() as { data: { is_default: boolean } | null };

  if (profile?.is_default) {
    return NextResponse.json(
      { error: 'Impossible de supprimer le profil par défaut — définissez-en un autre comme défaut d\'abord.' },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from('shipping_packaging_profiles')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
