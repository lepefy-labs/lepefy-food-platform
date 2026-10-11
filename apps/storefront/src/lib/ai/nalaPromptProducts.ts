import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchedProductContext } from '@/lib/ai/chatbox';
import { pickSellingFormatFields, type SellingFormatSource } from '@/lib/storefrontCopy/sellingFormat';

/** Ligne `match_products` (migrations 122 + 154) lue pour le contexte de Nala. */
export interface MatchProductsPromptRow extends SellingFormatSource {
  id: string;
  name: string;
  price: number;
  stock: number | null;
  storage_type: string | null;
  category_name: string | null;
  min_order_quantity?: number | null;
  order_quantity_step?: number | null;
}

/**
 * Produits trouvés → contexte du prompt de Nala (site et WhatsApp). Le poids
 * logistique (`weight_grams`) n'est jamais transmis : Nala ne doit pas le
 * présenter comme contenu. Les groupes à mélanger sont ajoutés quand ils sont
 * lisibles ; leur absence n'empêche jamais la réponse.
 */
export async function buildMatchedProductContexts(
  supabase: SupabaseClient,
  tenantId: string,
  currency: string,
  rows: MatchProductsPromptRow[],
): Promise<MatchedProductContext[]> {
  const groupByProduct = new Map<string, { name: string; minimum: number }>();
  if (rows.length) {
    try {
      const { data, error } = await supabase
        .from('purchase_quantity_groups')
        .select('name, min_quantity, purchase_quantity_group_products(product_id)')
        .eq('tenant_id', tenantId)
        .eq('active', true);
      if (error) throw new Error(error.message);
      const ids = new Set(rows.map((row) => row.id));
      for (const group of (data ?? []) as Array<{ name: string; min_quantity: number; purchase_quantity_group_products: Array<{ product_id: string }> | null }>) {
        for (const member of group.purchase_quantity_group_products ?? []) {
          if (ids.has(member.product_id)) groupByProduct.set(member.product_id, { name: group.name, minimum: group.min_quantity });
        }
      }
    } catch (error) {
      console.warn('[nala] quantity groups unavailable for prompt context:', error);
    }
  }
  return rows.map((row) => ({
    name: row.name.slice(0, 150),
    price: Number(row.price),
    currency,
    stock: row.stock,
    minOrderQuantity: row.min_order_quantity ?? 1,
    orderQuantityStep: row.order_quantity_step ?? 1,
    sellingFormat: pickSellingFormatFields(row),
    quantityGroup: groupByProduct.get(row.id) ?? null,
    storageType: row.storage_type,
    categoryName: row.category_name,
  }));
}
