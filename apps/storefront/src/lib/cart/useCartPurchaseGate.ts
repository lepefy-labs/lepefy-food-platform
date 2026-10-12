'use client';

import type { CartItem } from '@lepefy/types';
import type { PublicQuantityGroup } from '@/app/api/quantity-groups/route';
import { computeCartQuantityViolations } from '@/lib/cart/cartQuantityValidation';
import { useCartFulfillment } from '@/lib/cart/useCartFulfillment';
import { useQuantityGroups } from '@/lib/cart/useQuantityGroups';
import { cartFulfillmentBlockingMessage, type CartFulfillmentEligibility } from '@/lib/fulfillment/fulfillmentPolicy';
import { formatQuantityViolationMessage, getMaximumValidQuantity } from '@/lib/purchaseQuantityRules';
import { insufficientStockMessage } from '@/lib/storefrontCopy/availability';
import { useTenant } from '@/providers/TenantProvider';

export interface CartPurchaseGate {
  /** Groupes à mélanger actifs (pour afficher leur progression). */
  groups: PublicQuantityGroup[];
  /** Vérification des groupes ou du mode de réception en cours : ne pas encore autoriser la suite. */
  checking: boolean;
  /** Erreur de chargement (déjà rédigée pour le client). */
  error: string | null;
  /** Problèmes bloquants de quantité/stock, un par ligne, dans les mots du panier. */
  issues: string[];
  /** Mode de réception imposé par les produits (même moteur que le serveur). */
  fulfillment: CartFulfillmentEligibility;
  /** Premier message à afficher (vérification, erreur ou problème). */
  blockedMessage: string | null;
  canProceed: boolean;
  /** Recharge les règles (groupes et mode de réception). */
  reloadGroups: () => void;
}

/**
 * Pré-contrôle client du panier, partagé par `/cart` et `/checkout`. Même
 * moteurs que le serveur (`computeCartQuantityViolations` →
 * `validatePurchaseQuantityRules`, `computeCartFulfillment`) : il guide le
 * client, il ne remplace jamais la validation de `/api/checkout`.
 */
export function useCartPurchaseGate(items: CartItem[]): CartPurchaseGate {
  const tenant = useTenant();
  const { groups, loading, error, reload } = useQuantityGroups();
  const fulfillmentState = useCartFulfillment(items, Boolean(tenant.click_collect_enabled));
  const issues = computeCartQuantityViolations(items, groups).map(formatQuantityViolationMessage);
  for (const item of items) {
    const { stock, min_order_quantity: minimum, order_quantity_step: step } = item.product;
    if (stock < item.quantity || getMaximumValidQuantity(stock, minimum ?? 1, step ?? 1) === 0) {
      issues.push(insufficientStockMessage(item.product.name, stock));
    }
  }
  const checking = loading || fulfillmentState.loading;
  const combinedError = error ?? fulfillmentState.error;
  const blockedMessage = checking
    ? 'Vérification de votre panier…'
    : combinedError ?? issues[0] ?? cartFulfillmentBlockingMessage(fulfillmentState.eligibility);
  return {
    groups,
    checking,
    error: combinedError,
    issues,
    fulfillment: fulfillmentState.eligibility,
    blockedMessage,
    canProceed: !blockedMessage,
    reloadGroups: () => { reload(); fulfillmentState.reload(); },
  };
}
