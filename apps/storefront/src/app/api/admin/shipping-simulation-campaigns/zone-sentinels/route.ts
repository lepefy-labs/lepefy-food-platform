import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { fetchAllPages } from '@/lib/shipping/intelligence/pagedQuery';
import { planZoneSentinels, type PostalCandidate } from '@/lib/shipping/intelligence/zoneSentinels';
import { REJECTED_DESTINATION_ERRORS } from '@/lib/shipping/intelligence/campaignOutcomes';
import { normalizePostalCode } from '@/lib/shipping/intelligence/requestIdentity';
import type { ShippingZoneRow } from '@lepefy/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * GET /api/admin/shipping-simulation-campaigns/zone-sentinels?country=IT&perZone=2
 *
 * Aperçu (lecture seule) des CAP témoins par zone tarifaire active du tenant :
 * CAP de l'index GeoNames, hors CAP génériques d'avant réforme et hors CAP
 * déjà refusés par Packlink pour ce tenant. Ne crée aucune campagne.
 */
export async function GET(request: Request) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const country = (searchParams.get('country') ?? 'IT').trim().toUpperCase();
  const perZone = Number(searchParams.get('perZone') ?? 2);
  const includeUnzoned = searchParams.get('includeUnzoned') === '1';
  if (!/^[A-Z]{2}$/.test(country) || !Number.isFinite(perZone)) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const [{ data: zoneData, error: zoneError }, index, rejectedItems] = await Promise.all([
    supabase.from('shipping_zones').select('*').eq('tenant_id', tenant.id).eq('country', country).eq('active', true),
    fetchAllPages<{ postal_code: string; place_name: string; admin_code2: string | null }>((from, to) => supabase
      .from('shipping_postal_code_index')
      .select('postal_code, place_name, admin_code2')
      .eq('country', country)
      .order('postal_code', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PageResult<{ postal_code: string; place_name: string; admin_code2: string | null }>,
    { maxRows: 80_000 }),
    fetchAllPages<{ scenario: { destination: { country: string; postalCode: string } }; error: string | null }>((from, to) => supabase
      .from('shipping_simulation_campaign_items')
      .select('scenario, error')
      .eq('tenant_id', tenant.id)
      .eq('status', 'failed')
      .in('error', Array.from(REJECTED_DESTINATION_ERRORS))
      .order('id', { ascending: true })
      .range(from, to) as unknown as PageResult<{ scenario: { destination: { country: string; postalCode: string } }; error: string | null }>,
    { maxRows: 20_000 }),
  ]);

  if (zoneError || index.error || rejectedItems.error) {
    return NextResponse.json({ error: 'Impossible de préparer les CAP témoins.' }, { status: 500 });
  }

  const zones = (zoneData ?? []) as ShippingZoneRow[];
  if (index.rows.length === 0) {
    return NextResponse.json({
      error: 'L’index des codes postaux n’est pas importé pour ce pays (Laboratoire → Base de données des codes postaux).',
      zones: [],
    }, { status: 409 });
  }

  const rejectedPostalCodes = new Set(
    rejectedItems.rows
      .filter((row) => row.scenario?.destination?.country?.toUpperCase() === country)
      .map((row) => normalizePostalCode(row.scenario.destination.postalCode)),
  );

  const candidates: PostalCandidate[] = index.rows.map((row) => ({
    postalCode: row.postal_code,
    city: row.place_name,
    adminCode2: row.admin_code2,
  }));

  const plans = planZoneSentinels({ country, zones, candidates, perZone, rejectedPostalCodes, includeUnzoned });

  return NextResponse.json({
    country,
    perZone: Math.min(Math.max(Math.round(perZone), 1), 3),
    indexTruncated: index.truncated,
    zones: plans,
  });
}
