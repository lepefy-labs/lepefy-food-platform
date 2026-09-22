import type { createServiceClient } from '@/lib/supabase/server';
import {
  formatQuantityViolationMessage,
  validatePurchaseQuantityRules,
  type QuantityRuleViolation,
} from '@/lib/purchaseQuantityRules';

const MAX_QUANTITY_PER_ITEM = 999;

export interface CanonicalCheckoutProduct {
  id: string;
  name: string;
  price: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  stock: number;
  min_order_quantity: number;
  order_quantity_step: number;
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
    code: 'INVALID_ITEM' | 'PRODUCT_UNAVAILABLE' | 'QUANTITY_RULE_VIOLATION' | 'INSUFFICIENT_STOCK' | 'SERVER_ERROR';
    violations?: QuantityRuleViolation[];
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
 * Unique server authority for quantity rules across standard checkout,
 * external-link checkout, session edits and Stripe PaymentIntent recovery.
 * Always loads current tenant-scoped products and active group memberships.
 * The client and stored checkout_sessions.items are never trusted for rules.
 */
export async function validateCheckoutItems(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  rawItems: ReadonlyArray<{ productId: string | null; quantity: number }> | null | undefined,
): Promise<CheckoutItemsResult> {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.some((item) =>
    !item || typeof item.productId !== 'string' || !item.productId
    || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_ITEM
  )) {
    return { ok: false, status: 400, body: { error: 'Article invalide.', code: 'INVALID_ITEM' } };
  }

  const quantityByProduct = new Map<string, number>();
  for (const item of rawItems) {
    const productId = item.productId as string;
    const nextQuantity = (quantityByProduct.get(productId) ?? 0) + item.quantity;
    if (nextQuantity > MAX_QUANTITY_PER_ITEM) {
      return { ok: false, status: 400, body: { error: 'Quantité maximale dépassée.', code: 'INVALID_ITEM' } };
    }
    quantityByProduct.set(productId, nextQuantity);
  }

  const productIds = [...quantityByProduct.keys()];
  const { data: dbProducts, error: productsError } = await supabase
    .from('products')
    .select('id, name, price, storage_type, stock, min_order_quantity, order_quantity_step')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('id', productIds) as {
      data: CanonicalCheckoutProduct[] | null;
      error: unknown;
    };

  if (productsError || !dbProducts) {
    console.error('[checkout] Product quantity validation lookup failed:', productsError);
    return { ok: false, status: 500, body: { error: 'Erreur serveur. Veuillez réessayer.', code: 'SERVER_ERROR' } };
  }

  const productById = new Map(dbProducts.map((product) => [product.id, product]));
  if (productIds.some((id) => !productById.has(id))) {
    return { ok: false, status: 400, body: {
      error: 'Certains articles de votre panier ne sont plus disponibles.', code: 'PRODUCT_UNAVAILABLE',
    } };
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
    return { ok: false, status: 500, body: { error: 'Erreur serveur. Veuillez réessayer.', code: 'SERVER_ERROR' } };
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
      error: `Stock insuffisant pour : ${insufficientStock.join(', ')}.`,
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
