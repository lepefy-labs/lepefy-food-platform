import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { resolvePacklinkApiKey } from '@/lib/shipping/packlinkApiKey';
import { probePacklinkZones } from '@/lib/shipping/providers/packlinkZoneProbe';
import { checkPacklinkDestination } from '@/lib/shipping/providers/packlinkDestination';

/**
 * GET /api/admin/platform/shipping-zone-probe?zips=90133,09100,00144[&country=IT]
 * Platform owner only, read-only (Packlink GET locations, never a POST): shows
 * how Packlink represents the postal zones of the given CAPs (Sicily, Sardinia,
 * mainland) and whether the draft destination check accepts them. The key is
 * the current tenant's own, never returned.
 */
export async function GET(request: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const country = (searchParams.get('country') ?? 'IT').trim().toUpperCase();
  const zips = (searchParams.get('zips') ?? '').split(',').map((zip) => zip.trim()).filter((zip) => /^[0-9A-Za-z -]{3,10}$/.test(zip)).slice(0, 10);
  if (!/^[A-Z]{2}$/.test(country) || zips.length === 0) return NextResponse.json({ error: 'Paramètres invalides : country (ISO2) et zips.' }, { status: 400 });

  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? '');
  const { data } = await createServiceClient().from('tenants').select('packlink_api_key, is_test').eq('id', tenant.id).maybeSingle();
  const key = resolvePacklinkApiKey({ packlink_api_key: data?.packlink_api_key ?? null, is_test: data?.is_test ?? null });
  if (!key) return NextResponse.json({ error: 'Clé Packlink indisponible pour ce tenant.' }, { status: 409 });

  const probe = await probePacklinkZones(key, country, zips);
  const checks = probe.results.map((result) => ({
    zip: result.zip,
    zoneNames: result.zoneNames,
    destinationCheck: result.records.length === 1 ? checkPacklinkDestination(country, result.zip, result.zoneNames[0]) : null,
  }));
  return NextResponse.json({ ...probe, checks }, { headers: { 'Cache-Control': 'no-store' } });
}
