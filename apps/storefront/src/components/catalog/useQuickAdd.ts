'use client';

import { useEffect, useRef, useState } from 'react';
import { useCartStore } from '@/stores/cartStore';
import type { ProductCardProduct } from './ProductCard';
import { getMaximumValidQuantity } from '@/lib/purchaseQuantityRules';

/** Shared quick-add behavior; merchandise retains its existing cart behavior. */
export function useQuickAdd(product: ProductCardProduct, enforceStockLimit = false) {
  const addItem = useCartStore(s => s.addItem);
  const quantity = useCartStore(s => s.items.find(item => item.product.id === product.id)?.quantity ?? 0);
  const storedStock = useCartStore(s => s.items.find(item => item.product.id === product.id)?.product.stock ?? 999);
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const maxPurchasable = getMaximumValidQuantity(
    Math.min(product.stock ?? 999, storedStock),
    product.min_order_quantity,
    product.order_quantity_step,
  );
  const outOfStock = maxPurchasable === 0;
  const atLimit = enforceStockLimit && quantity >= maxPurchasable;

  useEffect(() => () => clearTimeout(timer.current), []);

  function addToCart(): boolean {
    if (outOfStock || atLimit) return false;
    const existing = useCartStore.getState().items.find(item => item.product.id === product.id);
    const liveMax = getMaximumValidQuantity(
      Math.min(product.stock ?? 999, existing?.product.stock ?? 999),
      product.min_order_quantity,
      product.order_quantity_step,
    );
    const previous = existing?.quantity ?? 0;
    if (liveMax === 0 || previous >= liveMax) return false;
    addItem({
      id: product.id,
      name: product.name,
      slug: product.slug,
      price: product.price,
      image_url: product.image_url,
      weight_grams: product.weight_grams,
      stock: product.stock ?? 999,
      storage_type: product.storage_type ?? null,
      min_order_quantity: product.min_order_quantity,
      order_quantity_step: product.order_quantity_step,
    });
    const updated = useCartStore.getState().items.find(item => item.product.id === product.id)?.quantity ?? 0;
    if (updated <= previous) return false;
    clearTimeout(timer.current);
    setAdded(true);
    timer.current = setTimeout(() => setAdded(false), 1500);
    return true;
  }
  return { addToCart, added, outOfStock, atLimit };
}
