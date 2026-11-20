'use client';

import type { ProductCardProduct } from './ProductCard';
import { useQuickAdd } from './useQuickAdd';
import { useCartLineQuantity } from '@/lib/cart/useCartLineQuantity';
import { useFormatUnits } from '@/lib/cart/useFormatUnits';
import { buildSaleFormatOptions } from '@/lib/catalog/saleFormats';
import { saleFormatOfferLine } from '@/lib/storefrontCopy/saleFormatCopy';

export interface SmartQuickAdd {
  /** Quantité au panier : unités de base pour une fiche à formats. */
  quantity: number;
  inCart: boolean;
  /** Rien d'achetable (épuisé, stock sous le minimum). */
  unavailable: boolean;
  /** Seuls des lots sont achetables : le choix se fait sur la fiche produit. */
  needsChoice: boolean;
  /** Quantité posée par « Ajouter » (minimum du produit ou du format de base). */
  firstAdd: number;
  canIncrement: boolean;
  removesOnDecrement: boolean;
  /** « 6 pour 18,00 € » : l'offre lot d'une fiche à formats, null sinon. */
  offerLine: string | null;
  /** Id de la ligne qui reste quand on retire la dernière unité (pour l'annulation du panier). */
  lastLineId: string;
  add: () => boolean;
  increment: () => void;
  decrement: () => 'decremented' | 'removed' | 'unchanged';
}

/**
 * Ajout rapide hors card (recherche du panier, suggestions après un ajout) :
 * même règle que la card. Une fiche à plusieurs formats (187) compte en
 * unités de base et le panier se recompose au meilleur prix (6 paquets → le
 * lot de 6), au lieu d'empiler des paquets à l'unité. Produit simple :
 * comportement inchangé (minimum, pas, stock).
 */
export function useSmartQuickAdd(product: ProductCardProduct, currency = 'EUR'): SmartQuickAdd {
  const quick = useQuickAdd(product, true);
  const line = useCartLineQuantity(product.id);
  const options = buildSaleFormatOptions(product);
  const formatUnits = useFormatUnits(product, options);
  if (options.length === 0) {
    const unavailable = quick.availability === 'sold_out' || quick.availability === 'below_minimum';
    return {
      quantity: line.quantity,
      inCart: line.quantity > 0,
      unavailable,
      needsChoice: false,
      firstAdd: product.min_order_quantity ?? 1,
      canIncrement: line.canIncrement && !quick.atLimit,
      removesOnDecrement: line.removesOnDecrement,
      offerLine: null,
      lastLineId: product.id,
      add: quick.addToCart,
      increment: line.increment,
      decrement: line.decrement,
    };
  }
  const base = options.find((option) => option.isBase);
  const baseBuyable = Boolean(base?.purchasable);
  const unavailable = !options.some((option) => option.purchasable);
  const firstAdd = base ? base.units * base.minimum : 1;
  return {
    quantity: formatUnits.units,
    inCart: formatUnits.units > 0,
    unavailable,
    needsChoice: !unavailable && !baseBuyable && formatUnits.units === 0,
    firstAdd,
    canIncrement: formatUnits.canIncrement,
    removesOnDecrement: formatUnits.removesOnDecrement,
    offerLine: saleFormatOfferLine(options, currency),
    lastLineId: base?.id ?? product.id,
    add: () => (baseBuyable ? formatUnits.addUnits(firstAdd) : false),
    increment: formatUnits.increment,
    decrement: formatUnits.decrement,
  };
}
