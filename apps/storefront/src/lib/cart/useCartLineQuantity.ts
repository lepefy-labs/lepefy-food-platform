'use client';

import { useCartStore } from '@/stores/cartStore';
import { useHydratedCartSelector } from './useHydratedCart';
import { decrementRemovesLine, stepPurchaseQuantity } from '@/lib/purchaseQuantityRules';

export interface CartLineQuantity {
  /** Quantité dans le panier (0 = absent). */
  quantity: number;
  /** Un «+» est possible (règle + stock connu de la ligne). */
  canIncrement: boolean;
  /** Le prochain «−» retirerait la ligne (affiché « Retirer »). */
  removesOnDecrement: boolean;
  increment: () => void;
  decrement: () => 'decremented' | 'removed' | 'unchanged';
}

/**
 * État +/− d'une ligne déjà dans le panier, partagé par la card, la fiche
 * produit, le panier, le drawer et la confirmation d'ajout. Les transitions
 * passent toutes par `cartStore.incrementItem/decrementItem` →
 * `stepPurchaseQuantity` ; chaque clic relit l'état du store de façon
 * synchrone, donc des clics rapides ne travaillent jamais sur une valeur périmée.
 * Le premier ajout (0 → minimum) reste `addItem` (useQuickAdd / fiche produit).
 */
export function useCartLineQuantity(productId: string): CartLineQuantity {
  // Absent (0) au rendu serveur et pendant l'hydratation : pas d'écart avec le HTML ISR.
  const line = useHydratedCartSelector((s) => s.items.find((item) => item.product.id === productId), undefined);
  const quantity = line?.quantity ?? 0;
  const minimum = line?.product.min_order_quantity ?? 1;
  const step = line?.product.order_quantity_step ?? 1;
  const stock = line?.product.stock ?? 0;
  return {
    quantity,
    canIncrement: quantity > 0 && stepPurchaseQuantity(quantity, minimum, step, stock, 'increment') !== null,
    removesOnDecrement: quantity > 0 && decrementRemovesLine(quantity, minimum, step),
    increment: () => useCartStore.getState().incrementItem(productId),
    decrement: () => useCartStore.getState().decrementItem(productId),
  };
}
