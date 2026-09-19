import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

function normalizePrefixes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const prefixes = raw.map((p) => String(p).trim()).filter(Boolean);
  return prefixes;
}

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('shipping_zones')
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

  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase().replace(/\s+/g, '_') : '';
  const country = typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
  const postalPrefixes = normalizePrefixes(body.postal_prefixes);

  if (!code || !/^[A-Z]{2}$/.test(country) || postalPrefixes === null) {
    return NextResponse.json({ error: 'Code de zone, pays (ISO2) et préfixes postaux requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: lastZone } = await supabase
    .from('shipping_zones')
    .select('position')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: { position: number } | null };
  const nextPosition = (lastZone?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from('shipping_zones')
    .insert({
      tenant_id: tenant.id,
      code,
      country,
      postal_prefixes: postalPrefixes,
      active: body.active === undefined ? true : Boolean(body.active),
      position: nextPosition,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Une zone avec ce code existe déjà.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
