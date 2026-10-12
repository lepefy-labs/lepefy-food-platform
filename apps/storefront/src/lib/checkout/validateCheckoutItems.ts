import { ERROR_COPY } from '@/lib/storefrontCopy/copy';
import type { createServiceClient } from '@/lib/supabase/server';
import {
  formatQuantityViolationMessage,
  validatePurchaseQuantityRules,
  type QuantityRuleViolation,
} from '@/lib/purchaseQuantityRules';
import {
  checkFulfillmentMode,
  computeCartFulfillment,
  type FulfillmentErrorCode,
  type FulfillmentMode,
  type FulfillmentViolation,
} from '@/lib/fulfillment/fulfillmentPolicy';
import type { ProductFulfillmentPolicy } from '@lepefy/types';

const MAX_QUANTITY_PER_ITEM = 999;

export interface CanonicalCheckoutProduct {
  id: string;
  name: string;
  price: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  stock: number;
  min_order_quantity: number;
  order_quantity_step: number;
  fulfillment_policy: ProductFulfillmentPolicy;
}

export interface CanonicalCheckoutItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
}

type CheckoutFailure = {
  ok: false;
  status: number;
  body: {
    error: string;
    code: 'INVALID_ITEM' | 'PRODUCT_UNAVAILABLE' | 'QUANTITY_RULE_VIOLATION' | 'INSUFFICIENT_STOCK' | 'SERVER_ERROR' | FulfillmentErrorCode;
    violations?: QuantityRuleViolation[];
    /** Détail du mode de réception refusé (modes possibles, produits en cause). */
    fulfillment?: Omit<FulfillmentViolation, 'code' | 'message'>;
  };
};
type CheckoutSuccess = {
  ok: true;
  items: CanonicalCheckoutItem[];
  products: CanonicalCheckoutProduct[];
  productById: Map<string, CanonicalCheckoutProduct>;
  quantityByProduct: Map<string, number>;
};

export type CheckoutItemsResult = CheckoutFailure | CheckoutSuccess;

/**
 * Mode de réception demandé et capacité de retrait du canal. Obligatoire :
 * chaque chemin de paiement doit dire comment la commande sera reçue.
 * - boutique en ligne : `pickupAvailable = tenant.click_collect_enabled`
 * - précommande assistée : `true` (retrait convenu par l'équipe, comme avant)
 */
export interface CheckoutFulfillmentInput {
  mode: FulfillmentMode;
  pickupAvailable: boolean;
}

/**
 * Unique server authority for quantity rules across standard checkout,
 * external-link checkout, session edits and Stripe PaymentIntent recovery.
 * Always loads current tenant-scoped products and active group memberships.
 * The client and stored checkout_sessions.items are never trusted for rules.
 * Also the single server authority for the product fulfillment policy
 * (migration 155): the requested mode must be allowed by the whole cart.
 */
export async function validateCheckoutItems(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  rawItems: ReadonlyArray<{ productId: string | null; quantity: number }> | null | undefined,
  fulfillment: CheckoutFulfillmentInput,
): Promise<CheckoutItemsResult> {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.some((item) =>
    !item || typeof item.productId !== 'string' || !item.productId
    || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_ITEM
  )) {
    return { ok: false, status: 400, body: { error: ERROR_COPY.invalidItem, code: 'INVALID_ITEM' } };
  }

  const quantityByProduct = new Map<string, number>();
  for (const item of rawItems) {
    const productId = item.productId as string;
    const nextQuantity = (quantityByProduct.get(productId) ?? 0) + item.quantity;
    if (nextQuantity > MAX_QUANTITY_PER_ITEM) {
      return { ok: false, status: 400, body: { error: ERROR_COPY.tooManyItems, code: 'INVALID_ITEM' } };
    }
    quantityByProduct.set(productId, nextQuantity);
  }

  const productIds = [...quantityByProduct.keys()];
  const { data: dbProducts, error: productsError } = await supabase
    .from('products')
    .select('id, name, price, storage_type, stock, min_order_quantity, order_quantity_step, fulfillment_policy')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('id', productIds) as {
      data: CanonicalCheckoutProduct[] | null;
      error: unknown;
    };

  if (productsError || !dbProducts) {
    console.error('[checkout] Product quantity validation lookup failed:', productsError);
    return { ok: false, status: 500, body: { error: ERROR_COPY.server, code: 'SERVER_ERROR' } };
  }

  const productById = new Map(dbProducts.map((product) => [product.id, product]));
  if (productIds.some((id) => !productById.has(id))) {
    return { ok: false, status: 400, body: {
      error: ERROR_COPY.productsUnavailable, code: 'PRODUCT_UNAVAILABLE',
    } };
  }

  // Mode de réception : panier incompatible, mode refusé ou retrait impossible
  // → refus avant toute commande, session ou PaymentIntent.
  const fulfillmentViolation = checkFulfillmentMode(
    computeCartFulfillment(dbProducts, { pickupAvailable: fulfillment.pickupAvailable }),
    fulfillment.mode,
  );
  if (fulfillmentViolation) {
    const { code, message, ...detail } = fulfillmentViolation;
    return { ok: false, status: 400, body: { error: message, code, fulfillment: detail } };
  }

  const { data: groupRows, error: groupsError } = await supabase
    .from('purchase_quantity_groups')
    .select('id, name, min_quantity, quantity_step, purchase_quantity_group_products(product_id)')
    .eq('tenant_id', tenantId)
    .eq('active', true) as {
      data: Array<{
        id: string;
        name: string;
        min_quantity: number;
        quantity_step: number;
        purchase_quantity_group_products: Array<{ product_id: string }>;
      }> | null;
      error: unknown;
    };

  if (groupsError || !groupRows) {
    console.error('[checkout] Group quantity validation lookup failed:', groupsError);
    return { ok: false, status: 500, body: { error: ERROR_COPY.server, code: 'SERVER_ERROR' } };
  }

  const quantityViolations = validatePurchaseQuantityRules(
    quantityByProduct,
    dbProducts,
    groupRows.map((group) => ({
      id: group.id,
      name: group.name,
      min_quantity: group.min_quantity,
      quantity_step: group.quantity_step,
      productIds: group.purchase_quantity_group_products.map((member) => member.product_id),
    })),
  );
  if (quantityViolations.length > 0) {
    return { ok: false, status: 400, body: {
      error: formatQuantityViolationMessage(quantityViolations[0]!),
      code: 'QUANTITY_RULE_VIOLATION',
      violations: quantityViolations,
    } };
  }

  const insufficientStock = [...quantityByProduct.entries()]
    .filter(([id, quantity]) => productById.get(id)!.stock < quantity)
    .map(([id]) => productById.get(id)!.name);
  if (insufficientStock.length) {
    return { ok: false, status: 400, body: {
      error: `Il n'en reste pas assez pour : ${insufficientStock.join(', ')}. Changez la quantité dans le panier.`,
      code: 'INSUFFICIENT_STOCK',
    } };
  }

  const items = rawItems.map((item) => {
    const product = productById.get(item.productId as string)!;
    return {
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
      storage_type: product.storage_type ?? 'dry' as const,
    };
  });

  return { ok: true, items, products: dbProducts, productById, quantityByProduct };
}
