import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingZoneRow } from '@lepefy/types';

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Résout la zone tenant correspondant à un pays/code postal, par préfixe le
 * plus long en priorité. Retourne null si aucune zone ne correspond — c'est
 * un cas normal (le tenant n'a pas encore défini de zones), pas une erreur.
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

  const zones = (data ?? []) as ShippingZoneRow[];
  const matches = zones.filter((z) => z.postal_prefixes.some((prefix) => postalCode.startsWith(prefix)));
  if (matches.length === 0) return null;

  const best = matches.reduce((longest, z) => {
    const zoneLongest = Math.max(...z.postal_prefixes.filter((p) => postalCode.startsWith(p)).map((p) => p.length));
    const currentLongest = Math.max(...longest.postal_prefixes.filter((p) => postalCode.startsWith(p)).map((p) => p.length));
    return zoneLongest > currentLongest ? z : longest;
  });

  return best.code;
}
