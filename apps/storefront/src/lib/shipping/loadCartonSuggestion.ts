import type { createServiceClient } from '@/lib/supabase/server';
import type { OrderItem } from '@lepefy/types';
import { suggestCartons, type CartonProfile, type CartonSuggestion, type DeclaredWeight } from './cartonSuggestion';
import { loadPackagingWeightBands } from './loadPackagingWeightBands';
import type { PackagingWeightBand } from './packagingWeight';
import { planTariffParcels } from './tariff/tariffQuote';

type ServiceClient = ReturnType<typeof createServiceClient>;
type CartonItem = Pick<OrderItem, 'product_id' | 'quantity'>;

/** Données tenant nécessaires au calcul, chargées une fois (y compris pour un lot de commandes). */
export interface CartonContext {
  profiles: CartonProfile[];
  maxParcelG: number;
  weightById: Map<string, number | null>;
  /** null = lecture impossible : aucun poids à déclarer plutôt qu'un chiffre faux. */
  packagingWeightBands?: PackagingWeightBand[] | null;
  defaultBox?: { length: number; width: number; height: number } | null;
}

export async function loadCartonContext(
  supabase: ServiceClient,
  tenantId: string,
  productIds: Array<string | null | undefined>,
): Promise<CartonContext> {
  const ids = Array.from(new Set(productIds.filter((id): id is string => Boolean(id))));
  const [packagingWeightBands, { data: profilesRaw }, { data: surchargeRaw }, { data: productsRaw }] = await Promise.all([
    loadPackagingWeightBands(supabase, tenantId).catch(() => null),
    supabase.from('shipping_packaging_profiles').select('*').eq('tenant_id', tenantId).eq('active', true),
    supabase.from('packaging_surcharges').select('max_pack_kg, box_length_cm, box_width_cm, box_height_cm').eq('tenant_id', tenantId).eq('active', true).maybeSingle(),
    ids.length > 0
      ? supabase.from('products').select('id, weight_grams').eq('tenant_id', tenantId).in('id', ids)
      : Promise.resolve({ data: [] as { id: string; weight_grams: number | null }[] }),
  ]);
  const surcharge = surchargeRaw as { max_pack_kg?: number; box_length_cm?: number; box_width_cm?: number; box_height_cm?: number } | null;
  const maxPackKg = Number(surcharge?.max_pack_kg) || 15;
  const length = Number(surcharge?.box_length_cm);
  const width = Number(surcharge?.box_width_cm);
  const height = Number(surcharge?.box_height_cm);
  return {
    profiles: (profilesRaw ?? []) as CartonProfile[],
    maxParcelG: maxPackKg * 1000,
    weightById: new Map(((productsRaw ?? []) as { id: string; weight_grams: number | null }[]).map((p) => [p.id, p.weight_grams])),
    packagingWeightBands,
    defaultBox: length > 0 && width > 0 && height > 0 ? { length, width, height } : null,
  };
}

/** Pur : même plan de colis que la bozza ; null si le poids envoyé est le poids net ou n'est pas connu. */
export function declaredWeightFor(context: CartonContext, netWeightG: number): DeclaredWeight | null {
  if (!context.packagingWeightBands) return null;
  const plan = planTariffParcels(netWeightG, context.maxParcelG, context.profiles as Parameters<typeof planTariffParcels>[2],
    context.defaultBox ?? null, context.packagingWeightBands);
  if (!plan || plan.length === 0) return null;
  const totalG = plan.reduce((sum, parcel) => sum + parcel.grossG, 0);
  if (totalG === netWeightG) return null;
  return { packagingG: totalG - netWeightG, totalG, parcelsG: plan.map((parcel) => parcel.grossG) };
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
  const suggestion = suggestCartons(totalWeightG, context.profiles, context.maxParcelG);
  return {
    suggestion: suggestion ? { ...suggestion, declared: declaredWeightFor(context, totalWeightG) } : null,
    missingWeightLines,
  };
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
