import type { createServiceClient } from '@/lib/supabase/server';
import type { OrderItem } from '@lepefy/types';
import { suggestCartons, type CartonProfile, type CartonSuggestion } from './cartonSuggestion';

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Carton suggéré pour une commande (détail commande admin + picking list imprimable).
 * Poids : celui calculé au checkout (`shipping_details.totalWeightG`), sinon recalculé
 * depuis les produits ; les lignes sans poids sont comptées dans `missingWeightLines`.
 */
export async function loadCartonSuggestion(
  supabase: ServiceClient,
  tenantId: string,
  items: Pick<OrderItem, 'product_id' | 'quantity'>[],
  checkoutWeightG: number | null | undefined,
): Promise<{ suggestion: CartonSuggestion | null; missingWeightLines: number }> {
  const [{ data: profilesRaw }, { data: surchargeRaw }] = await Promise.all([
    supabase.from('shipping_packaging_profiles').select('*').eq('tenant_id', tenantId).eq('active', true),
    supabase.from('packaging_surcharges').select('max_pack_kg').eq('tenant_id', tenantId).eq('active', true).maybeSingle(),
  ]);
  const profiles = (profilesRaw ?? []) as CartonProfile[];

  let missingWeightLines = 0;
  let totalWeightG = checkoutWeightG ?? null;
  if (totalWeightG == null) {
    const productIds = Array.from(new Set(items.map((item) => item.product_id).filter((id): id is string => Boolean(id))));
    const { data: productsRaw } = productIds.length > 0
      ? await supabase.from('products').select('id, weight_grams').eq('tenant_id', tenantId).in('id', productIds)
      : { data: [] };
    const weightById = new Map(((productsRaw ?? []) as { id: string; weight_grams: number | null }[]).map((p) => [p.id, p.weight_grams]));
    totalWeightG = 0;
    for (const item of items) {
      const weight = item.product_id ? weightById.get(item.product_id) : null;
      if (weight == null) { missingWeightLines += 1; continue; }
      totalWeightG += weight * item.quantity;
    }
  }

  const maxPackKg = Number((surchargeRaw as { max_pack_kg?: number } | null)?.max_pack_kg) || 15;
  return { suggestion: suggestCartons(totalWeightG, profiles, maxPackKg * 1000), missingWeightLines };
}
