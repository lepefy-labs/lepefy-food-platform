/**
 * GET /api/admin/shipping-geo-policy → politique géographique du tenant (shipping.view)
 * PUT /api/admin/shipping-geo-policy (shipping.manage)
 *   { destinationMode, includedCountries, excludedCountries, providerFallbackEnabled,
 *     storageRules: { dry|fresh|frozen: { mode, countries } }, expectedVersion }
 *
 * Le tenant vient toujours de getTenant(), jamais du corps. Chaque écriture
 * incrémente `policy_version` (compare-and-set): les devis signés avant la
 * modification deviennent inutilisables (409 SHIPPING_REQUOTE_REQUIRED).
 * Migration 179 absente → 409, rien n'est écrit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { loadConfiguredCountries, loadGeoPolicy } from '@/lib/shipping/geo/geoPolicyServer';
import { parseGeoPolicyInput } from '@/lib/shipping/geo/geoPolicy';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const supabase = createServiceClient();
  try {
    const [policy, configuredCountries] = await Promise.all([
      loadGeoPolicy(supabase, tenant.id),
      loadConfiguredCountries(supabase, tenant.id),
    ]);
    return NextResponse.json({ policy, configuredCountries });
  } catch {
    return NextResponse.json({ error: 'Lecture impossible.' }, { status: 500 });
  }
}

async function handlePUT(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const parsed = parseGeoPolicyInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const expectedVersion = Number.isInteger(body?.expectedVersion) ? Number(body?.expectedVersion) : null;
  if (expectedVersion === null || expectedVersion < 0) {
    return NextResponse.json({ error: 'Version attendue manquante.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const adminId = await getAdminId();
  const v = parsed.value;
  const row = {
    destination_mode: v.destinationMode,
    included_countries: v.includedCountries,
    excluded_countries: v.excludedCountries,
    provider_fallback_enabled: v.providerFallbackEnabled,
    storage_rules: v.storageRules,
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  };

  const conflict = NextResponse.json(
    { error: 'La configuration a été modifiée entre-temps. Rechargez la page.' }, { status: 409 },
  );

  if (expectedVersion === 0) {
    const { error } = await supabase.from('tenant_shipping_geo_policy')
      .insert({ tenant_id: tenant.id, ...row, policy_version: 1 });
    if (error) {
      if ((error as { code?: string }).code === '23505') return conflict;
      if ((error as { code?: string }).code === '42P01') {
        return NextResponse.json({ error: 'Migration 179 non appliquée.' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
    }
    return NextResponse.json({ version: 1 });
  }

  const { data, error } = await supabase.from('tenant_shipping_geo_policy')
    .update({ ...row, policy_version: expectedVersion + 1 })
    .eq('tenant_id', tenant.id)
    .eq('policy_version', expectedVersion)
    .select('policy_version');
  if (error) return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  if (!data || data.length === 0) return conflict;
  console.info('[shipping-geo-policy] tenant:', tenant.id, '— version →', expectedVersion + 1, '— admin:', adminId);
  return NextResponse.json({ version: expectedVersion + 1 });
}

export const PUT = withStorefrontInvalidation(['tenant'], handlePUT);
