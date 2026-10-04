import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { duplicatePrefixes, type ZoneLike } from '@/lib/shipping/shippingRuleConflicts';

export const runtime = 'nodejs';

function normalizePrefixes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((p) => String(p).trim()).filter(Boolean);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const updatePayload: Record<string, unknown> = {};

  if ('code' in body) {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase().replace(/\s+/g, '_') : '';
    if (!code) return NextResponse.json({ error: 'Code de zone requis.' }, { status: 400 });
    updatePayload.code = code;
  }
  if ('country' in body) {
    const country = typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: 'Pays invalide.' }, { status: 400 });
    updatePayload.country = country;
  }
  if ('postal_prefixes' in body) {
    const prefixes = normalizePrefixes(body.postal_prefixes);
    if (prefixes === null) return NextResponse.json({ error: 'Préfixes postaux invalides.' }, { status: 400 });
    updatePayload.postal_prefixes = prefixes;
  }
  if ('active' in body) updatePayload.active = Boolean(body.active);
  if ('position' in body) updatePayload.position = parseInt(String(body.position), 10) || 0;

  const supabase = createServiceClient();

  // No prefix shared with another active zone of the same country (see POST).
  if ('country' in updatePayload || 'postal_prefixes' in updatePayload || updatePayload.active === true) {
    const { data: existing, error: existingError } = await supabase
      .from('shipping_zones')
      .select('id, code, country, postal_prefixes, active')
      .eq('tenant_id', tenant.id);
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
    const rows = (existing ?? []) as ZoneLike[];
    const current = rows.find((row) => row.id === params.id);
    if (!current) return NextResponse.json({ error: 'Zone introuvable.' }, { status: 404 });
    const duplicates = duplicatePrefixes({
      id: current.id,
      country: (updatePayload.country as string | undefined) ?? current.country,
      postal_prefixes: (updatePayload.postal_prefixes as string[] | undefined) ?? current.postal_prefixes,
      active: (updatePayload.active as boolean | undefined) ?? current.active,
    }, rows);
    if (duplicates.length > 0) {
      return NextResponse.json({ error: `Préfixe(s) déjà utilisé(s) par une autre zone active de ce pays : ${duplicates.join(', ')}.`, code: 'PREFIX_OVERLAP', prefixes: duplicates }, { status: 409 });
    }
  }

  const { error } = await supabase
    .from('shipping_zones')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Une zone avec ce code existe déjà.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('shipping_zones')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
