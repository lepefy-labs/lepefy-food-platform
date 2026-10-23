import { hasPurchasableQuantity } from '@/lib/purchaseQuantityRules';

export interface SuggestionCandidate {
  id: string;
  stock: number | null;
  min_order_quantity?: number | null;
  order_quantity_step?: number | null;
}

/** Nombre de suggestions « Complétez votre panier » (défaut et plafond). */
export const CART_SUGGESTION_LIMIT = 8;
/** Plafond d'une requête : le panier en demande plus pour garder ceux qui rentrent dans le colis. */
export const MAX_CART_SUGGESTION_LIMIT = 16;
export const MAX_CART_SUGGESTION_SOURCES = 30;

/** Achetable maintenant : le stock couvre au moins la quantité minimale (règle du produit). */
export function isSuggestionPurchasable(product: SuggestionCandidate): boolean {
  return hasPurchasableQuantity(product.stock ?? 0, product.min_order_quantity || 1, product.order_quantity_step || 1);
}

/**
 * Suggestions du panier, règle pure : les sources sont passées par priorité
 * (complémentaires déclarés par la boutique, petits plus, promotions actives, meilleures
 * ventes, ordre du catalogue) ; on garde l'ordre, sans doublon, sans les
 * produits déjà au panier ni ceux qu'on ne peut pas acheter, jusqu'à `limit`.
 * Aucune association n'est inventée : une source vide est simplement sautée.
 */
export function assembleCartSuggestions<T extends SuggestionCandidate>(
  sources: ReadonlyArray<ReadonlyArray<T>>,
  cartProductIds: Iterable<string>,
  limit = CART_SUGGESTION_LIMIT,
): T[] {
  const excluded = new Set(cartProductIds);
  const result: T[] = [];
  for (const source of sources) {
    for (const product of source) {
      if (result.length >= limit) return result;
      if (excluded.has(product.id) || !isSuggestionPurchasable(product)) continue;
      excluded.add(product.id);
      result.push(product);
    }
  }
  return result;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?ids=` : produits du panier, UUID uniquement, sans doublon, au plus 30. */
export function parseCartProductIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const ids = raw.split(',').map((id) => id.trim()).filter((id) => UUID_PATTERN.test(id));
  return [...new Set(ids)].slice(0, MAX_CART_SUGGESTION_SOURCES);
}
