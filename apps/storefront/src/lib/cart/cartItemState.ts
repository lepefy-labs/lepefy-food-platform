// État visuel d'une ligne de panier (§9 de la spec redesign) — fonction pure,
// aucune dépendance React/store, testable isolément.
//
// Priorité volontaire unavailable > out_of_stock > pending > normal :
// un produit retiré du catalogue (unavailable) reste indisponible même s'il
// a par ailleurs un stock résiduel affiché côté client (donnée non rafraîchie
// depuis le dernier sync) — l'information la plus bloquante gagne toujours.
export type CartItemUiState = 'normal' | 'pending' | 'unavailable' | 'out_of_stock';

export function deriveCartItemState(params: {
  productId: string;
  stock: number;
  unavailableProductIds: string[];
  pendingProductIds: Set<string>;
}): CartItemUiState {
  if (params.unavailableProductIds.includes(params.productId)) return 'unavailable';
  if (params.stock === 0) return 'out_of_stock';
  if (params.pendingProductIds.has(params.productId)) return 'pending';
  return 'normal';
}
