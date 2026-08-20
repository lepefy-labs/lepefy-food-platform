import { test, expect } from '@playwright/test';
import { mergeGuestCartWithServerCart } from '@/lib/cart/mergeCarts';
import { cartItem, quantityOf, PRODUCT_A, PRODUCT_B, PRODUCT_C } from './helpers/cartFixtures';

// Merge carrello guest ↔ carrello server al login — funzione pura.

test('Caso A — locale vuoto, server pieno : si adotta il carrello server', async () => {
  const result = mergeGuestCartWithServerCart([], [cartItem(PRODUCT_A, 2)]);

  expect(result.items).toHaveLength(1);
  expect(quantityOf(result.items, PRODUCT_A.id)).toBe(2);
  // Il server è già in questo stato: nessuna richiesta di scrittura necessaria.
  expect(result.mutations).toHaveLength(0);
});

test('Caso B — locale pieno, server vuoto : si carica il carrello locale', async () => {
  const result = mergeGuestCartWithServerCart([cartItem(PRODUCT_A, 3)], []);

  expect(quantityOf(result.items, PRODUCT_A.id)).toBe(3);
  expect(result.mutations).toEqual([
    { type: 'set_quantity', productId: PRODUCT_A.id, quantity: 3 },
  ]);
});

test('Caso C — entrambi pieni : unione dei prodotti', async () => {
  const result = mergeGuestCartWithServerCart(
    [cartItem(PRODUCT_B, 1)],
    [cartItem(PRODUCT_A, 2)],
  );

  expect(result.items).toHaveLength(2);
  expect(quantityOf(result.items, PRODUCT_A.id)).toBe(2);
  expect(result.items[0]!.product.id).toBe(PRODUCT_A.id); // ordine deterministico
  expect(result.mutations).toEqual([
    { type: 'set_quantity', productId: PRODUCT_B.id, quantity: 1 },
  ]);
});

test('stesso prodotto, quantità diverse : MAX e non somma', async () => {
  const result = mergeGuestCartWithServerCart(
    [cartItem(PRODUCT_A, 3)],
    [cartItem(PRODUCT_A, 5)],
  );

  expect(quantityOf(result.items, PRODUCT_A.id)).toBe(5);
  expect(quantityOf(result.items, PRODUCT_A.id)).not.toBe(8);
  // Il server è già a 5 : nessuna scrittura inutile.
  expect(result.mutations).toHaveLength(0);
});

test('stesso prodotto, il locale è più alto : il server viene allineato', async () => {
  const result = mergeGuestCartWithServerCart(
    [cartItem(PRODUCT_A, 6)],
    [cartItem(PRODUCT_A, 2)],
  );

  expect(quantityOf(result.items, PRODUCT_A.id)).toBe(6);
  expect(result.mutations).toEqual([
    { type: 'set_quantity', productId: PRODUCT_A.id, quantity: 6 },
  ]);
});

test('il merge è idempotente : rieseguirlo non moltiplica le quantità', async () => {
  const local  = [cartItem(PRODUCT_A, 3)];
  const server = [cartItem(PRODUCT_A, 5)];

  const first  = mergeGuestCartWithServerCart(local, server);
  const second = mergeGuestCartWithServerCart(first.items, first.items);

  expect(second.items).toEqual(first.items);
  expect(second.mutations).toHaveLength(0);
});

test('la quantità è normalizzata sullo stock', async () => {
  const result = mergeGuestCartWithServerCart(
    [cartItem(PRODUCT_C, 50)],
    [],
  );
  expect(quantityOf(result.items, PRODUCT_C.id)).toBe(PRODUCT_C.stock);
});

test('le info prodotto del server sono preferite a quelle locali', async () => {
  const staleLocal = cartItem(PRODUCT_A, 1);
  staleLocal.product = { ...staleLocal.product, price: 0.01, name: 'Prix périmé' };

  const result = mergeGuestCartWithServerCart([staleLocal], [cartItem(PRODUCT_A, 1)]);

  expect(result.items[0]!.product.price).toBe(PRODUCT_A.price);
  expect(result.items[0]!.product.name).toBe(PRODUCT_A.name);
});
