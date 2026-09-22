import { test, expect } from '@playwright/test';
import { computeCartQuantityViolations } from '../../src/lib/cart/cartQuantityValidation';
import { formatQuantityViolationMessage } from '../../src/lib/purchaseQuantityRules';
import type { CartItem } from '@lepefy/types';

function item(id: string, name: string, quantity: number, minOrderQuantity = 1, orderQuantityStep = 1): CartItem {
  return {
    product: {
      id,
      name,
      slug: id,
      price: 1,
      image_url: null,
      weight_grams: null,
      stock: 999,
      storage_type: null,
      min_order_quantity: minOrderQuantity,
      order_quantity_step: orderQuantityStep,
    },
    quantity,
  };
}

test('un panier sans règle active ne produit aucune violation', () => {
  const violations = computeCartQuantityViolations([item('a', 'A', 1)], []);
  expect(violations).toEqual([]);
});

test('un produit sous son minimum est détecté avant le checkout', () => {
  const violations = computeCartQuantityViolations([item('ndole', 'Ndolè frais', 2, 4, 1)], []);
  expect(violations).toEqual([expect.objectContaining({ type: 'PRODUCT_MINIMUM', productId: 'ndole', missingQuantity: 2 })]);
  expect(formatQuantityViolationMessage(violations[0]!)).toContain('Ndolè frais');
});

test('un groupe combinable sous son minimum est détecté avant le checkout', () => {
  const items = [item('coca', 'Coca', 3), item('fanta', 'Fanta', 2)];
  const groups = [{ id: 'boissons', name: 'Boissons', min_quantity: 12, quantity_step: 1, productIds: ['coca', 'fanta'] }];
  const violations = computeCartQuantityViolations(items, groups);
  expect(violations).toEqual([expect.objectContaining({ type: 'GROUP_MINIMUM', groupName: 'Boissons', currentQuantity: 5, missingQuantity: 7 })]);
});

test('un panier valide (produit et groupe) ne bloque rien', () => {
  const items = [item('ndole', 'Ndolè frais', 4, 4, 1), item('coca', 'Coca', 12)];
  const groups = [{ id: 'boissons', name: 'Boissons', min_quantity: 12, quantity_step: 1, productIds: ['coca'] }];
  expect(computeCartQuantityViolations(items, groups)).toEqual([]);
});
