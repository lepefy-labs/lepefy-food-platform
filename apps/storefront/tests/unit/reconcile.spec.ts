import { test, expect } from '@playwright/test';
import { reconcileCart } from '@/lib/cart/reconcile';
import { createPendingMutation } from '@/lib/cart/cartQueue';
import { cartItem, quantityOf, PRODUCT_A, PRODUCT_B, PRODUCT_C } from './helpers/cartFixtures';

// Riconciliazione : stato server come base + mutation pendenti riapplicate.

test('senza mutation pendenti lo stato server è adottato tale e quale', async () => {
  const result = reconcileCart([cartItem(PRODUCT_A, 2)], [cartItem(PRODUCT_B, 9)], []);

  expect(result).toHaveLength(1);
  expect(quantityOf(result, PRODUCT_A.id)).toBe(2);
});

test('un add pendente si applica SOPRA lo stato server (nessuna perdita)', async () => {
  const result = reconcileCart(
    [cartItem(PRODUCT_A, 2)],       // l'altro device ha portato A a 2
    [cartItem(PRODUCT_B, 1)],
    [createPendingMutation({ type: 'add', productId: PRODUCT_B.id, quantity: 1 })],
  );

  expect(quantityOf(result, PRODUCT_A.id)).toBe(2);
  expect(quantityOf(result, PRODUCT_B.id)).toBe(1);
});

test('un add pendente sullo stesso prodotto si somma allo stato server', async () => {
  const result = reconcileCart(
    [cartItem(PRODUCT_A, 2)],
    [cartItem(PRODUCT_A, 3)],
    [createPendingMutation({ type: 'add', productId: PRODUCT_A.id, quantity: 1 })],
  );

  expect(quantityOf(result, PRODUCT_A.id)).toBe(3);
});

test('un set_quantity pendente sovrascrive lo stato server per quel prodotto', async () => {
  const result = reconcileCart(
    [cartItem(PRODUCT_A, 9)],
    [cartItem(PRODUCT_A, 4)],
    [createPendingMutation({ type: 'set_quantity', productId: PRODUCT_A.id, quantity: 4 })],
  );

  expect(quantityOf(result, PRODUCT_A.id)).toBe(4);
});

test('un remove pendente elimina la riga anche se il server la contiene', async () => {
  const result = reconcileCart(
    [cartItem(PRODUCT_A, 2), cartItem(PRODUCT_B, 1)],
    [],
    [createPendingMutation({ type: 'remove', productId: PRODUCT_A.id })],
  );

  expect(result).toHaveLength(1);
  expect(result[0]!.product.id).toBe(PRODUCT_B.id);
});

test('senza mutation pendenti un articolo rimosso altrove NON riappare', async () => {
  // Regressione del comportamento precedente : il merge "somma" faceva
  // resuscitare un articolo cancellato da un altro device.
  const result = reconcileCart([], [cartItem(PRODUCT_A, 2)], []);
  expect(result).toHaveLength(0);
});

test('clear pendente svuota, e gli add successivi si riapplicano dopo', async () => {
  const result = reconcileCart(
    [cartItem(PRODUCT_A, 2)],
    [cartItem(PRODUCT_B, 1)],
    [
      createPendingMutation({ type: 'clear' }),
      createPendingMutation({ type: 'add', productId: PRODUCT_B.id, quantity: 1 }),
    ],
  );

  expect(result).toHaveLength(1);
  expect(quantityOf(result, PRODUCT_B.id)).toBe(1);
});

test('la quantità riconciliata è normalizzata sullo stock', async () => {
  const result = reconcileCart(
    [cartItem(PRODUCT_C, 3)],
    [],
    [createPendingMutation({ type: 'add', productId: PRODUCT_C.id, quantity: 10 })],
  );

  expect(quantityOf(result, PRODUCT_C.id)).toBe(PRODUCT_C.stock);
});

test('una mutation su un prodotto sconosciuto non fa crollare la riconciliazione', async () => {
  const result = reconcileCart(
    [cartItem(PRODUCT_A, 1)],
    [],
    [createPendingMutation({ type: 'add', productId: 'inconnu', quantity: 1 })],
  );

  expect(result).toHaveLength(1);
  expect(quantityOf(result, PRODUCT_A.id)).toBe(1);
});
