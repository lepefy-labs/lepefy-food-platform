import type { CartItem } from '@lepefy/types';
import type { FakeProduct } from './fakeCartServer';

export const PRODUCT_A: FakeProduct = {
  id: 'prod-a', name: 'Attiéké', price: 4.5, stock: 20, active: true, tenantId: 'tenant-1',
};
export const PRODUCT_B: FakeProduct = {
  id: 'prod-b', name: 'Piment', price: 2.9, stock: 20, active: true, tenantId: 'tenant-1',
};
export const PRODUCT_C: FakeProduct = {
  id: 'prod-c', name: 'Gari', price: 3.2, stock: 3, active: true, tenantId: 'tenant-1',
};
/** Prodotto disattivato lato catalogo — deve essere rifiutato dal server. */
export const PRODUCT_INACTIVE: FakeProduct = {
  id: 'prod-off', name: 'Retiré', price: 1, stock: 5, active: false, tenantId: 'tenant-1',
};
/** Prodotto di un ALTRO tenant — non deve mai entrare nel carrello. */
export const PRODUCT_OTHER_TENANT: FakeProduct = {
  id: 'prod-x', name: 'Autre boutique', price: 1, stock: 5, active: true, tenantId: 'tenant-2',
};

export const ALL_PRODUCTS = [
  PRODUCT_A, PRODUCT_B, PRODUCT_C, PRODUCT_INACTIVE, PRODUCT_OTHER_TENANT,
];

export function cartProduct(p: FakeProduct): CartItem['product'] {
  return {
    id: p.id, name: p.name, slug: p.id, price: p.price,
    image_url: null, weight_grams: 400, stock: p.stock, storage_type: 'dry',
  };
}

export function cartItem(p: FakeProduct, quantity: number): CartItem {
  return { product: cartProduct(p), quantity };
}

export function quantityOf(items: CartItem[], productId: string): number {
  return items.find((i) => i.product.id === productId)?.quantity ?? 0;
}
