'use client';

import type { ProductCardProduct } from './ProductCard';
import { useQuickAdd } from './useQuickAdd';
import { useCartLineQuantity } from '@/lib/cart/useCartLineQuantity';
import { useFormatUnits } from '@/lib/cart/useFormatUnits';
import type { DecrementPriceRise } from '@/lib/catalog/saleFormats';
import { buildSaleFormatOptions } from '@/lib/catalog/saleFormats';
import { saleFormatOfferLine } from '@/lib/storefrontCopy/saleFormatCopy';

export interface SmartQuickAdd {
  /** Quantité au panier : unités de base pour une fiche à formats. */
  quantity: number;
  inCart: boolean;
  /** Rien d'achetable (épuisé, stock sous le minimum). */
  unavailable: boolean;
  /**
   * Plusieurs formats achetables (même règle que la card, « Choisir le
   * format ») : le premier ajout passe par le choix du format sur la fiche
   * produit, jamais un paquet à l'unité ajouté d'office.
   */
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
  /** Fiche à formats : « − » qui ferait payer plus, en attente du choix du client. */
  priceRise: DecrementPriceRise | null;
  confirmDecrement: () => void;
  keepUnits: () => void;
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
      priceRise: null,
      confirmDecrement: () => {},
      keepUnits: () => {},
    };
  }
  const base = options.find((option) => option.isBase);
  const baseBuyable = Boolean(base?.purchasable);
  const purchasable = options.filter((option) => option.purchasable);
  const unavailable = purchasable.length === 0;
  // Règle de la card (`choosesFormat`) : ajout direct seulement si la base est le seul format achetable.
  const choosesFormat = !(purchasable.length === 1 && purchasable[0]!.isBase);
  const firstAdd = base ? base.units * base.minimum : 1;
  return {
    quantity: formatUnits.units,
    inCart: formatUnits.units > 0,
    unavailable,
    needsChoice: !unavailable && choosesFormat && formatUnits.units === 0,
    firstAdd,
    canIncrement: formatUnits.canIncrement,
    removesOnDecrement: formatUnits.removesOnDecrement,
    offerLine: saleFormatOfferLine(options, currency),
    lastLineId: base?.id ?? product.id,
    add: () => (baseBuyable && !choosesFormat ? formatUnits.addUnits(firstAdd) : false),
    increment: formatUnits.increment,
    decrement: formatUnits.decrement,
    priceRise: formatUnits.priceRise,
    confirmDecrement: formatUnits.confirmDecrement,
    keepUnits: formatUnits.keepUnits,
  };
}
