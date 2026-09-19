import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

function parsePositiveInt(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('shipping_packaging_profiles')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const boxLengthCm = parsePositiveInt(body.box_length_cm);
  const boxWidthCm = parsePositiveInt(body.box_width_cm);
  const boxHeightCm = parsePositiveInt(body.box_height_cm);
  const maxWeightG = parsePositiveInt(body.max_weight_g);

  if (!name || !boxLengthCm || !boxWidthCm || !boxHeightCm || !maxWeightG) {
    return NextResponse.json({ error: 'Nom et dimensions/poids requis (valeurs positives).' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: lastProfile } = await supabase
    .from('shipping_packaging_profiles')
    .select('position')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: { position: number } | null };
  const nextPosition = (lastProfile?.position ?? -1) + 1;

  const isDefault = Boolean(body.is_default);
  if (isDefault) {
    await supabase.from('shipping_packaging_profiles')
      .update({ is_default: false })
      .eq('tenant_id', tenant.id)
      .eq('is_default', true);
  }

  const { data, error } = await supabase
    .from('shipping_packaging_profiles')
    .insert({
      tenant_id: tenant.id,
      name,
      box_length_cm: boxLengthCm,
      box_width_cm: boxWidthCm,
      box_height_cm: boxHeightCm,
      max_weight_g: maxWeightG,
      is_default: isDefault,
      active: body.active === undefined ? true : Boolean(body.active),
      position: nextPosition,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
