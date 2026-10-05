import type { createServiceClient } from '@/lib/supabase/server';
import type { OrderItem } from '@lepefy/types';
import { suggestCartons, type CartonProfile, type CartonSuggestion } from './cartonSuggestion';

type ServiceClient = ReturnType<typeof createServiceClient>;
type CartonItem = Pick<OrderItem, 'product_id' | 'quantity'>;

/** Données tenant nécessaires au calcul, chargées une fois (y compris pour un lot de commandes). */
export interface CartonContext {
  profiles: CartonProfile[];
  maxParcelG: number;
  weightById: Map<string, number | null>;
}

export async function loadCartonContext(
  supabase: ServiceClient,
  tenantId: string,
  productIds: Array<string | null | undefined>,
): Promise<CartonContext> {
  const ids = Array.from(new Set(productIds.filter((id): id is string => Boolean(id))));
  const [{ data: profilesRaw }, { data: surchargeRaw }, { data: productsRaw }] = await Promise.all([
    supabase.from('shipping_packaging_profiles').select('*').eq('tenant_id', tenantId).eq('active', true),
    supabase.from('packaging_surcharges').select('max_pack_kg').eq('tenant_id', tenantId).eq('active', true).maybeSingle(),
    ids.length > 0
      ? supabase.from('products').select('id, weight_grams').eq('tenant_id', tenantId).in('id', ids)
      : Promise.resolve({ data: [] as { id: string; weight_grams: number | null }[] }),
  ]);
  const maxPackKg = Number((surchargeRaw as { max_pack_kg?: number } | null)?.max_pack_kg) || 15;
  return {
    profiles: (profilesRaw ?? []) as CartonProfile[],
    maxParcelG: maxPackKg * 1000,
    weightById: new Map(((productsRaw ?? []) as { id: string; weight_grams: number | null }[]).map((p) => [p.id, p.weight_grams])),
  };
}

/** Pur : poids du checkout s'il existe, sinon somme des poids produits (lignes sans poids comptées). */
export function computeCartonSuggestion(
  context: CartonContext,
  items: CartonItem[],
  checkoutWeightG: number | null | undefined,
): { suggestion: CartonSuggestion | null; missingWeightLines: number } {
  let missingWeightLines = 0;
  let totalWeightG = checkoutWeightG ?? null;
  if (totalWeightG == null) {
    totalWeightG = 0;
    for (const item of items) {
      const weight = item.product_id ? context.weightById.get(item.product_id) : null;
      if (weight == null) { missingWeightLines += 1; continue; }
      totalWeightG += weight * item.quantity;
    }
  }
  return { suggestion: suggestCartons(totalWeightG, context.profiles, context.maxParcelG), missingWeightLines };
}

/**
 * Carton suggéré pour une commande (détail commande admin + liste de préparation PDF).
 * Poids : celui calculé au checkout (`shipping_details.totalWeightG`), sinon recalculé
 * depuis les produits ; les lignes sans poids sont comptées dans `missingWeightLines`.
 */
export async function loadCartonSuggestion(
  supabase: ServiceClient,
  tenantId: string,
  items: CartonItem[],
  checkoutWeightG: number | null | undefined,
): Promise<{ suggestion: CartonSuggestion | null; missingWeightLines: number }> {
  const context = await loadCartonContext(supabase, tenantId, checkoutWeightG == null ? items.map((item) => item.product_id) : []);
  return computeCartonSuggestion(context, items, checkoutWeightG);
}
