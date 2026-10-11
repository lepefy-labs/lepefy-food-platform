/**
 * Disponibilité vue par le client. Distingue toujours un produit épuisé
 * (stock 0) d'un produit dont le stock ne couvre pas le minimum d'achat.
 * Les quantités viennent de `lib/purchaseQuantityRules.ts`, jamais recalculées.
 */

import { getMaximumValidQuantity } from '../purchaseQuantityRules';

export type ProductAvailability = 'available' | 'sold_out' | 'below_minimum' | 'at_limit';

export interface AvailabilityInput {
  stock: number | null | undefined;
  minimum?: number | null;
  step?: number | null;
  /** Quantité déjà dans le panier (0 si absente). */
  inCart?: number;
  /** Plafond vérifié en plus (dernier stock connu du panier, etc.). */
  maxPurchasable?: number;
}

export function deriveAvailability(input: AvailabilityInput): ProductAvailability {
  const stock = input.stock ?? 999;
  const minimum = input.minimum ?? 1;
  const step = input.step ?? 1;
  const max = input.maxPurchasable ?? getMaximumValidQuantity(stock, minimum, step);
  if (max === 0) return stock <= 0 ? 'sold_out' : 'below_minimum';
  if ((input.inCart ?? 0) >= max) return 'at_limit';
  return 'available';
}

export const AVAILABILITY_COPY = {
  soldOutBadge: 'Pas disponible',
  belowMinimumBadge: 'Pas disponible pour le moment',
  unavailableCta: 'Pas disponible',
  atLimitCta: 'Maximum atteint',
  atLimitHelp: 'Vous avez déjà pris tout ce qui est disponible.',
  soldOutDetail: 'Ce produit est épuisé. Revenez bientôt.',
} as const;

export function belowMinimumDetail(minimum: number): string {
  return `Il n'en reste pas assez pour le minimum de ${minimum}.`;
}

export type CartLineIssue =
  | { kind: 'removed'; message: string }
  | { kind: 'sold_out'; message: string }
  | { kind: 'below_minimum'; message: string }
  | { kind: 'over_stock'; message: string; target: number };

/**
 * Problème bloquant d'une ligne de panier, avec l'action à faire.
 * `countLabel` met en forme une quantité (« 6 paquets » ou « 6 »).
 */
export function cartLineIssue(input: {
  removed: boolean;
  stock: number;
  quantity: number;
  minimum: number;
  step: number;
  countLabel?: (count: number) => string;
}): CartLineIssue | null {
  const label = input.countLabel ?? String;
  if (input.removed) return { kind: 'removed', message: 'Plus vendu. Retirez-le pour continuer.' };
  if (input.stock <= 0) return { kind: 'sold_out', message: 'Plus disponible. Retirez-le pour continuer.' };
  const max = getMaximumValidQuantity(input.stock, input.minimum, input.step);
  if (max === 0) {
    return {
      kind: 'below_minimum',
      message: `Il n'en reste que ${input.stock} : pas assez pour le minimum de ${input.minimum}. Retirez ce produit.`,
    };
  }
  if (input.quantity > max) {
    return { kind: 'over_stock', target: max, message: `Il n'en reste que ${input.stock}. Passez à ${label(max)}.` };
  }
  return null;
}

/** Message de blocage global quand le stock d'une ligne ne suffit plus. */
export function insufficientStockMessage(productName: string, stock: number): string {
  return stock > 0
    ? `${productName} : il n'en reste que ${stock}. Changez la quantité pour continuer.`
    : `${productName} n'est plus disponible. Retirez-le pour continuer.`;
}
