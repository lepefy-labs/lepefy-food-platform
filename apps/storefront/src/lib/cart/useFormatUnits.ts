'use client';

import { useEffect, useState } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useHydratedCartItems } from './useHydratedCart';
import {
  decrementPriceRise,
  maxBundleUnits,
  planFormatBundle,
  type DecrementPriceRise,
  type FormatBundlePlan,
  type SaleFormatOption,
} from '@/lib/catalog/saleFormats';
import { toFormatCartProduct, type FormatParentForCart } from './saleFormatCart';

export interface FormatUnitsControl {
  /** Unités de base dans le panier pour cette fiche (tous formats confondus). */
  units: number;
  /** Composition actuelle du panier (lignes réelles). */
  current: FormatBundlePlan | null;
  /** Plafond (stock, règles) ; le « + » s'arrête là. */
  maxUnits: number;
  canIncrement: boolean;
  /** Le prochain « − » vide la fiche du panier (corbeille). */
  removesOnDecrement: boolean;
  increment: () => void;
  /**
   * Retire une unité. Si la recomposition ferait payer plus (on perd un lot),
   * rien ne change : `priceRise` est rempli et le client choisit.
   */
  decrement: () => 'decremented' | 'removed' | 'unchanged';
  /** Hausse de prix en attente de confirmation après un « − », null sinon. */
  priceRise: DecrementPriceRise | null;
  /** Applique le « − » malgré la hausse annoncée. */
  confirmDecrement: () => void;
  /** Garde la quantité actuelle (ferme l'avis). */
  keepUnits: () => void;
  /** Ajoute `count` unités de base (choix d'un format : 1 paquet = 1, lot de 3 = 3). */
  addUnits: (count: number) => boolean;
}

function cartUnits(options: SaleFormatOption[]): number {
  const items = useCartStore.getState().items;
  return options.reduce((sum, option) => sum + (items.find((item) => item.product.id === option.id)?.quantity ?? 0) * option.units, 0);
}

function cartTotal(options: SaleFormatOption[]): number {
  const items = useCartStore.getState().items;
  return options.reduce((sum, option) => sum + (items.find((item) => item.product.id === option.id)?.quantity ?? 0) * option.price, 0);
}

/**
 * Applique la combinaison la moins chère pour `units` unités de base. Relit le
 * store au moment du clic (jamais une valeur périmée), puis remplace les
 * quantités de tous les formats de la fiche en une fois.
 */
export function setFormatUnits(parent: FormatParentForCart, options: SaleFormatOption[], units: number): boolean {
  const ids = options.map((option) => option.id);
  if (units <= 0) {
    useCartStore.getState().applyFormatPlan([], ids);
    return true;
  }
  const plan = planFormatBundle(units, options);
  if (!plan) return false;
  useCartStore.getState().applyFormatPlan(
    plan.lines.map((line) => ({ product: toFormatCartProduct(parent, line.option), quantity: line.quantity })),
    ids,
  );
  return cartUnits(options) === units;
}

/**
 * Compteur en unités de base d'une fiche à plusieurs formats (card, fiche,
 * panier, drawer) : « + » ajoute une unité, « − » en retire une, et le panier
 * se recompose seul (3 paquets → 1 lot ; 1 lot − 1 → 2 paquets).
 */
export function useFormatUnits(parent: FormatParentForCart, options: SaleFormatOption[]): FormatUnitsControl {
  const items = useHydratedCartItems();
  const units = options.reduce((sum, option) => sum + (items.find((item) => item.product.id === option.id)?.quantity ?? 0) * option.units, 0);
  const current: FormatBundlePlan | null = units > 0
    ? {
        units,
        lines: options
          .map((option) => ({ option, quantity: items.find((item) => item.product.id === option.id)?.quantity ?? 0 }))
          .filter((line) => line.quantity > 0),
        total: options.reduce((sum, option) => sum + (items.find((item) => item.product.id === option.id)?.quantity ?? 0) * option.price, 0),
        // Économie réelle de la composition actuelle (jamais celle d'un plan théorique).
        savings: (() => {
          const base = options.find((option) => option.isBase);
          const total = options.reduce((sum, option) => sum + (items.find((item) => item.product.id === option.id)?.quantity ?? 0) * option.price, 0);
          const saving = base ? Math.round((base.price * units - total) * 100) / 100 : 0;
          return saving >= 0.01 ? saving : 0;
        })(),
      }
    : null;
  const maxUnits = options.length ? maxBundleUnits(options) : 0;
  // Avis « une unité de moins coûte plus » : valable seulement pour la quantité où il a été demandé.
  const [pendingRise, setPendingRise] = useState<DecrementPriceRise | null>(null);
  const priceRise = pendingRise && pendingRise.fromUnits === units ? pendingRise : null;
  useEffect(() => {
    if (pendingRise && pendingRise.fromUnits !== units) setPendingRise(null);
  }, [pendingRise, units]);
  return {
    units,
    current,
    maxUnits,
    canIncrement: units < maxUnits,
    removesOnDecrement: units === 1,
    increment: () => {
      setPendingRise(null);
      const live = cartUnits(options);
      if (live < maxUnits) setFormatUnits(parent, options, live + 1);
    },
    decrement: () => {
      const live = cartUnits(options);
      if (live <= 0) return 'unchanged';
      const rise = decrementPriceRise(live, cartTotal(options), options);
      if (rise) {
        setPendingRise(rise);
        return 'unchanged';
      }
      setPendingRise(null);
      setFormatUnits(parent, options, live - 1);
      return live - 1 === 0 ? 'removed' : 'decremented';
    },
    priceRise,
    confirmDecrement: () => {
      const rise = pendingRise;
      setPendingRise(null);
      // Relit le panier : le changement ne s'applique qu'à la quantité annoncée.
      if (rise && cartUnits(options) === rise.fromUnits) setFormatUnits(parent, options, rise.units);
    },
    keepUnits: () => setPendingRise(null),
    addUnits: (count) => {
      setPendingRise(null);
      const live = cartUnits(options);
      const target = Math.min(maxUnits, live + Math.max(0, count));
      if (target <= live) return false;
      return setFormatUnits(parent, options, target);
    },
  };
}
