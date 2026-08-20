import { test, expect } from '@playwright/test';
import { loadCart, resetCart } from './helpers/loadCart';
import { cartProduct, PRODUCT_A, PRODUCT_B, PRODUCT_C } from './helpers/cartFixtures';

// Store — API pubblica invariata rispetto all'implementazione precedente.

test.beforeEach(async () => { await resetCart(); });

test('addItem inserisce un articolo e ne somma la quantità', async () => {
  const { store } = await loadCart();
  const { addItem } = store.useCartStore.getState();

  addItem(cartProduct(PRODUCT_A));
  addItem(cartProduct(PRODUCT_A), 2);
  addItem(cartProduct(PRODUCT_B), 4);

  const state = store.useCartStore.getState();
  expect(state.items).toHaveLength(2);
  expect(state.items[0]!.quantity).toBe(3);
  expect(state.items[1]!.quantity).toBe(4);
  expect(state.totalItems()).toBe(7);
});

test('addItem non supera mai lo stock disponibile', async () => {
  const { store } = await loadCart();
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_C), 2);
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_C), 10);

  expect(store.useCartStore.getState().items[0]!.quantity).toBe(PRODUCT_C.stock);
});

test('removeItem elimina la riga', async () => {
  const { store } = await loadCart();
  const s = store.useCartStore.getState();
  s.addItem(cartProduct(PRODUCT_A));
  s.addItem(cartProduct(PRODUCT_B));
  s.removeItem(PRODUCT_A.id);

  const items = store.useCartStore.getState().items;
  expect(items).toHaveLength(1);
  expect(items[0]!.product.id).toBe(PRODUCT_B.id);
});

test('updateQuantity imposta la quantità, e a 0 rimuove la riga', async () => {
  const { store } = await loadCart();
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);

  store.useCartStore.getState().updateQuantity(PRODUCT_A.id, 5);
  expect(store.useCartStore.getState().items[0]!.quantity).toBe(5);

  store.useCartStore.getState().updateQuantity(PRODUCT_A.id, 0);
  expect(store.useCartStore.getState().items).toHaveLength(0);
});

test('clearCart svuota il carrello', async () => {
  const { store } = await loadCart();
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);
  store.useCartStore.getState().clearCart();

  expect(store.useCartStore.getState().items).toHaveLength(0);
  expect(store.useCartStore.getState().totalItems()).toBe(0);
});

test('totalPrice, totalWeightG e shippingPayload restano invariati', async () => {
  const { store } = await loadCart();
  const s = store.useCartStore.getState();
  s.addItem(cartProduct(PRODUCT_A), 2);   // 4.50 × 2, 400 g × 2
  s.addItem(cartProduct(PRODUCT_B), 1);   // 2.90 × 1, 400 g × 1

  const state = store.useCartStore.getState();
  expect(state.totalPrice()).toBeCloseTo(11.9, 5);
  expect(state.totalWeightG()).toBe(1200);
  expect(state.shippingPayload()).toEqual([
    { product_id: PRODUCT_A.id, weight_grams: 400, quantity: 2 },
    { product_id: PRODUCT_B.id, weight_grams: 400, quantity: 1 },
  ]);
});

// ─── Carrello guest ────────────────────────────────────────────────────────

test('il carrello guest è persistito in localStorage e sopravvive a un refresh', async () => {
  const { store } = await loadCart();
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 3);

  // Ciò che sopravvive a un reload è esattamente il contenuto di localStorage.
  const persisted = JSON.parse(globalThis.localStorage.getItem('lepefy-cart') ?? '{}');
  expect(persisted.state.items).toHaveLength(1);
  expect(persisted.state.items[0].quantity).toBe(3);

  // Rilettura come farebbe zustand/persist al reload della pagina.
  store.useCartStore.setState({ items: persisted.state.items });
  expect(store.useCartStore.getState().totalItems()).toBe(3);
});

test('un guest non genera MAI mutation da inviare al server', async () => {
  const { store } = await loadCart();
  const s = store.useCartStore.getState();
  s.addItem(cartProduct(PRODUCT_A), 3);
  s.updateQuantity(PRODUCT_A.id, 1);
  s.removeItem(PRODUCT_A.id);
  s.clearCart();

  expect(store.useCartStore.getState().pendingMutations).toHaveLength(0);
  expect(store.useCartStore.getState().pendingMutationCount()).toBe(0);
});

test('un cliente autenticato accoda mutation con la semantica corretta', async () => {
  const { store } = await loadCart();
  store.useCartStore.setState({ ownerCustomerId: 'cust-1' });

  const s = store.useCartStore.getState();
  s.addItem(cartProduct(PRODUCT_A), 2);
  s.updateQuantity(PRODUCT_A.id, 5);
  s.addItem(cartProduct(PRODUCT_B), 1);

  const pending = store.useCartStore.getState().pendingMutations;
  // add + set_quantity sullo stesso prodotto → il set assorbe l'add, poi l'add
  // su un prodotto diverso resta separato.
  expect(pending.map((m) => m.type)).toEqual(['set_quantity', 'add']);
  expect(pending[0]).toMatchObject({ type: 'set_quantity', productId: PRODUCT_A.id, quantity: 5 });
  expect(pending[1]).toMatchObject({ type: 'add', productId: PRODUCT_B.id, quantity: 1 });
  expect(pending.every((m) => typeof m.id === 'string' && m.id.length > 0)).toBe(true);
});
