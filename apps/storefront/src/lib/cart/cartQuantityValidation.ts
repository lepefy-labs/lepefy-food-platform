import type { CartItem } from '@lepefy/types';
import { validatePurchaseQuantityRules, type QuantityRuleViolation } from '@/lib/purchaseQuantityRules';
import type { PublicQuantityGroup } from '@/app/api/quantity-groups/route';

/**
 * Version client de la validation faite au checkout (`/api/checkout`) — même
 * moteur (`validatePurchaseQuantityRules`), pour bloquer *avant* que le
 * client n'atteigne la page de paiement plutôt que de le laisser découvrir
 * le problème au dernier moment. Le serveur reste la seule autorité réelle :
 * ceci ne fait que guider, jamais garantir (cf. purchaseQuantityRules.ts).
 */
export function computeCartQuantityViolations(
  items: CartItem[],
  groups: PublicQuantityGroup[],
): QuantityRuleViolation[] {
  const quantityByProductId = new Map<string, number>();
  for (const item of items) {
    quantityByProductId.set(item.product.id, (quantityByProductId.get(item.product.id) ?? 0) + item.quantity);
  }

  const products = items.map((item) => ({
    id: item.product.id,
    name: item.product.name,
    min_order_quantity: item.product.min_order_quantity ?? 1,
    order_quantity_step: item.product.order_quantity_step ?? 1,
  }));

  return validatePurchaseQuantityRules(quantityByProductId, products, groups);
}
