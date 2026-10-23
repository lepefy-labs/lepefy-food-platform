import type { createClient } from '@/lib/supabase/server';
import { PRODUCT_CARD_SELECT } from '@/lib/catalog/productCardSelect';
import { isMissingAddOnColumn, MAX_ADD_ONS } from '@/lib/catalog/addOns';
import { isSuggestionPurchasable, type SuggestionCandidate } from '@/lib/cart/cartSuggestionRules';

/** Cartes du bloc « Les petits plus » du catalogue (même limite que Promos et Nouveautés). */
export const ADD_ONS_SHELF_LIMIT = 10;

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * « Petits plus » du tenant, dans l'ordre de la boutique (`add_on_position`,
 * migration 165), limités aux catégories boutique et achetables maintenant
 * (stock ≥ minimum). Lignes fraîches (prix, stock), projection des cartes.
 * Migration absente ou erreur : aucun produit, jamais d'erreur pour la page.
 */
export async function getAddOnProducts<T extends SuggestionCandidate>(
  supabase: SupabaseClient,
  tenantId: string,
  categoryIds: readonly string[],
): Promise<T[]> {
  if (!categoryIds.length) return [];
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_CARD_SELECT)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('category_id', [...categoryIds])
    .not('add_on_position', 'is', null)
    .order('add_on_position')
    .limit(MAX_ADD_ONS);
  if (isMissingAddOnColumn(error) || error) return [];
  return ((data ?? []) as unknown as T[]).filter(isSuggestionPurchasable);
}
