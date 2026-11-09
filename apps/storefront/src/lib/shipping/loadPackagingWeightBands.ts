import type { createServiceClient } from '@/lib/supabase/server';
import { bandsFromRows, type PackagingWeightBand, type PackagingWeightBandRow } from './packagingWeight';

type ServiceClient = ReturnType<typeof createServiceClient>;

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

export function isMissingPackagingWeightTable(error: { code?: string } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_TABLE_CODES.has(error.code));
}

/**
 * Tranches du tenant, toujours relues (jamais de cache : elles entrent dans un
 * prix). Migration 180 absente → [] (comportement historique). Toute autre
 * erreur lève : un devis ou une bozza ne part pas avec un poids sous-estimé.
 */
export async function loadPackagingWeightBands(supabase: ServiceClient, tenantId: string): Promise<PackagingWeightBand[]> {
  const { data, error } = await supabase
    .from('shipping_packaging_weight_bands')
    .select('min_weight_g_exclusive, max_weight_g_inclusive, added_weight_g')
    .eq('tenant_id', tenantId);
  if (error) {
    if (isMissingPackagingWeightTable(error as { code?: string })) return [];
    throw new Error('packaging_weight_lookup_failed');
  }
  return bandsFromRows((data ?? []) as PackagingWeightBandRow[]);
}
