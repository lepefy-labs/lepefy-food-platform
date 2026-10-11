'use client';

import type { CartItem } from '@lepefy/types';
import type { PublicQuantityGroup } from '@/app/api/quantity-groups/route';
import { computeCartQuantityViolations } from '@/lib/cart/cartQuantityValidation';
import { useQuantityGroups } from '@/lib/cart/useQuantityGroups';
import { formatQuantityViolationMessage, getMaximumValidQuantity } from '@/lib/purchaseQuantityRules';
import { insufficientStockMessage } from '@/lib/storefrontCopy/availability';

export interface CartPurchaseGate {
  /** Groupes à mélanger actifs (pour afficher leur progression). */
  groups: PublicQuantityGroup[];
  /** Vérification des groupes en cours : ne pas encore autoriser la suite. */
  checking: boolean;
  /** Erreur de chargement des groupes (déjà rédigée pour le client). */
  error: string | null;
  /** Problèmes bloquants, un par ligne, dans les mots du panier. */
  issues: string[];
  /** Premier message à afficher (vérification, erreur ou problème). */
  blockedMessage: string | null;
  canProceed: boolean;
  reloadGroups: () => void;
}

/**
 * Pré-contrôle client du panier, partagé par `/cart` et `/checkout`. Même
 * moteur que le serveur (`computeCartQuantityViolations` →
 * `validatePurchaseQuantityRules`) : il guide le client, il ne remplace
 * jamais la validation de `/api/checkout`.
 */
export function useCartPurchaseGate(items: CartItem[]): CartPurchaseGate {
  const { groups, loading, error, reload } = useQuantityGroups();
  const issues = computeCartQuantityViolations(items, groups).map(formatQuantityViolationMessage);
  for (const item of items) {
    const { stock, min_order_quantity: minimum, order_quantity_step: step } = item.product;
    if (stock < item.quantity || getMaximumValidQuantity(stock, minimum ?? 1, step ?? 1) === 0) {
      issues.push(insufficientStockMessage(item.product.name, stock));
    }
  }
  const blockedMessage = loading
    ? 'Vérification de votre panier…'
    : error ?? issues[0] ?? null;
  return { groups, checking: loading, error, issues, blockedMessage, canProceed: !blockedMessage, reloadGroups: reload };
}
