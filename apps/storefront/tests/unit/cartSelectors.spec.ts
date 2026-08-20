import { test, expect } from '@playwright/test';
import {
  selectCartItems,
  selectCartItemCount,
  selectCartSubtotal,
  selectCartIsEmpty,
  selectPendingProductIds,
} from '@/lib/cart/cartSelectors';
import { cartItem, PRODUCT_A, PRODUCT_B } from './helpers/cartFixtures';
import { createPendingMutation } from '@/lib/cart/cartQueue';

test('selectCartItems retourne l\'array tel quel', async () => {
  const items = [cartItem(PRODUCT_A, 2)];
  expect(selectCartItems({ items })).toBe(items);
});

test('selectCartItemCount somme les quantités, pas le nombre de lignes', async () => {
  const items = [cartItem(PRODUCT_A, 2), cartItem(PRODUCT_B, 3)];
  expect(selectCartItemCount({ items })).toBe(5);
});

test('selectCartItemCount sur panier vide', async () => {
  expect(selectCartItemCount({ items: [] })).toBe(0);
});

test('selectCartSubtotal multiplie prix × quantité et somme', async () => {
  const items = [cartItem(PRODUCT_A, 2), cartItem(PRODUCT_B, 1)];
  const expected = PRODUCT_A.price * 2 + PRODUCT_B.price * 1;
  expect(selectCartSubtotal({ items })).toBeCloseTo(expected, 5);
});

test('selectCartIsEmpty', async () => {
  expect(selectCartIsEmpty({ items: [] })).toBe(true);
  expect(selectCartIsEmpty({ items: [cartItem(PRODUCT_A, 1)] })).toBe(false);
});

test('selectPendingProductIds ignore les mutations clear (pas de productId)', async () => {
  const pendingMutations = [
    createPendingMutation({ type: 'add', productId: PRODUCT_A.id, quantity: 1 }),
    createPendingMutation({ type: 'clear' }),
  ];
  const ids = selectPendingProductIds({ pendingMutations });
  expect(ids.has(PRODUCT_A.id)).toBe(true);
  expect(ids.size).toBe(1);
});

test('selectPendingProductIds dédoublonne plusieurs mutations sur le même produit', async () => {
  const pendingMutations = [
    createPendingMutation({ type: 'add', productId: PRODUCT_A.id, quantity: 1 }),
    createPendingMutation({ type: 'set_quantity', productId: PRODUCT_A.id, quantity: 3 }),
  ];
  const ids = selectPendingProductIds({ pendingMutations });
  expect(ids.size).toBe(1);
  expect([...ids]).toEqual([PRODUCT_A.id]);
});
