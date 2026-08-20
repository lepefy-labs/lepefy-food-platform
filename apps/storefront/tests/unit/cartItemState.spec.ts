import { test, expect } from '@playwright/test';
import { deriveCartItemState } from '@/lib/cart/cartItemState';

test('normal quand rien de particulier ne s\'applique', async () => {
  const state = deriveCartItemState({
    productId: 'p1', stock: 10, unavailableProductIds: [], pendingProductIds: new Set(),
  });
  expect(state).toBe('normal');
});

test('pending quand une mutation est en attente pour ce produit', async () => {
  const state = deriveCartItemState({
    productId: 'p1', stock: 10, unavailableProductIds: [], pendingProductIds: new Set(['p1']),
  });
  expect(state).toBe('pending');
});

test('out_of_stock quand le stock est à 0', async () => {
  const state = deriveCartItemState({
    productId: 'p1', stock: 0, unavailableProductIds: [], pendingProductIds: new Set(),
  });
  expect(state).toBe('out_of_stock');
});

test('unavailable quand le produit est dans unavailableProductIds', async () => {
  const state = deriveCartItemState({
    productId: 'p1', stock: 10, unavailableProductIds: ['p1'], pendingProductIds: new Set(),
  });
  expect(state).toBe('unavailable');
});

test('unavailable est prioritaire sur out_of_stock et pending', async () => {
  const state = deriveCartItemState({
    productId: 'p1', stock: 0, unavailableProductIds: ['p1'], pendingProductIds: new Set(['p1']),
  });
  expect(state).toBe('unavailable');
});

test('out_of_stock est prioritaire sur pending', async () => {
  const state = deriveCartItemState({
    productId: 'p1', stock: 0, unavailableProductIds: [], pendingProductIds: new Set(['p1']),
  });
  expect(state).toBe('out_of_stock');
});

test('un autre produit pending/unavailable n\'affecte pas celui-ci', async () => {
  const state = deriveCartItemState({
    productId: 'p1', stock: 10, unavailableProductIds: ['p2'], pendingProductIds: new Set(['p2']),
  });
  expect(state).toBe('normal');
});
