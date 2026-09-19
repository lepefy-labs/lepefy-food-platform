import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingZoneRow } from '@lepefy/types';

type ServiceClient = ReturnType<typeof createServiceClient>;

export function resolveZoneCodeFromRows(
  zones: ShippingZoneRow[],
  country: string,
  postalCode: string,
): string | null {
  const normalizedCountry = country.trim().toUpperCase();
  const normalizedPostalCode = postalCode.trim().toUpperCase();
  const matches = zones.filter((zone) =>
    zone.active
    && zone.country.toUpperCase() === normalizedCountry
    && zone.postal_prefixes.some((prefix) => normalizedPostalCode.startsWith(prefix.toUpperCase())),
  );
  if (matches.length === 0) return null;

  const best = matches.reduce((longest, zone) => {
    const zoneLongest = Math.max(
      ...zone.postal_prefixes
        .filter((prefix) => normalizedPostalCode.startsWith(prefix.toUpperCase()))
        .map((prefix) => prefix.length),
    );
    const currentLongest = Math.max(
      ...longest.postal_prefixes
        .filter((prefix) => normalizedPostalCode.startsWith(prefix.toUpperCase()))
        .map((prefix) => prefix.length),
    );
    return zoneLongest > currentLongest ? zone : longest;
  });
  return best.code;
}

/**
 * Résout la zone tenant correspondant à un pays/code postal, par préfixe le
 * plus long en priorité. Retourne null si aucune zone ne correspond.
 */
export async function resolveZoneCode(
  supabase: ServiceClient,
  tenantId: string,
  country: string,
  postalCode: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('shipping_zones')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('country', country)
    .eq('active', true);

  return resolveZoneCodeFromRows((data ?? []) as ShippingZoneRow[], country, postalCode);
}
