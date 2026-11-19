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
import { aggregateStockDemand, stockSourceId, unitsPerSale } from '@/lib/catalog/saleFormats';
import { formatCount, resolveSellingFormat } from '@/lib/storefrontCopy/sellingFormat';

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
  issues.push(...formatStockIssues(items));
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

/**
 * Formats de vente (187) : plusieurs lignes peuvent puiser dans le même stock
 * (2 lots de 3 + 1 paquet = 7 paquets). Stock connu côté client : celui de la
 * fiche si elle est dans le panier, sinon la meilleure borne déduite des lots.
 * Guide seulement ; le serveur recompte tout.
 */
function formatStockIssues(items: CartItem[]): string[] {
  const shared = items.filter((item) => stockSourceId(item.product) !== item.product.id
    || items.some((other) => other !== item && other.product.format_parent_id === item.product.id));
  if (shared.length < 2) return [];
  const demand = aggregateStockDemand(shared.map((item) => ({ productId: item.product.id, quantity: item.quantity, row: item.product })));
  const issues: string[] = [];
  for (const [sourceId, units] of demand) {
    const lines = shared.filter((item) => stockSourceId(item.product) === sourceId);
    if (lines.length < 2) continue;
    const base = items.find((item) => item.product.id === sourceId);
    const available = base
      ? base.product.stock
      : Math.max(...lines.map((item) => item.product.stock * unitsPerSale(item.product)));
    if (units > available) {
      const name = base?.product.name ?? lines[0]!.product.name.split(' — ')[0]!;
      const count = base ? formatCount(resolveSellingFormat(base.product), available) : String(available);
      issues.push(`${name} : il en reste ${count} au total pour tous les formats. Réduisez une des quantités pour continuer.`);
    }
  }
  return issues;
}
