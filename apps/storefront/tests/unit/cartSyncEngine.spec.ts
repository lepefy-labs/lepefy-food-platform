import { test, expect } from '@playwright/test';
import { loadCart, resetCart, wait } from './helpers/loadCart';
import { setOnline } from './helpers/browserEnv';
import { FakeCartServer, installFetch, installFailingFetch } from './helpers/fakeCartServer';
import {
  ALL_PRODUCTS, cartProduct, quantityOf,
  PRODUCT_A, PRODUCT_B, PRODUCT_INACTIVE,
} from './helpers/cartFixtures';

let server: FakeCartServer;

test.beforeEach(async () => {
  await resetCart();
  setOnline(true);
  server = new FakeCartServer(ALL_PRODUCTS);
  installFetch(server);
});

// ─── Idratazione / login ───────────────────────────────────────────────────

test('login con carrello locale vuoto : il carrello server è ripristinato', async () => {
  server.items = [{ product_id: PRODUCT_A.id, quantity: 2 }];
  server.version = 4;

  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  const state = store.useCartStore.getState();
  expect(quantityOf(state.items, PRODUCT_A.id)).toBe(2);
  expect(state.serverVersion).toBe(4);
  expect(state.pendingMutations).toHaveLength(0);
  expect(state.syncStatus).toBe('synced');
});

test('login con carrello guest : il carrello locale è caricato sul server', async () => {
  const { store, engine } = await loadCart();
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 3);

  await engine.hydrateCartForCustomer('cust-1');

  expect(server.items).toEqual([{ product_id: PRODUCT_A.id, quantity: 3 }]);
  expect(store.useCartStore.getState().pendingMutations).toHaveLength(0);
  expect(store.useCartStore.getState().syncStatus).toBe('synced');
});

test('login con entrambi pieni : merge, quantità = max, poi sync', async () => {
  server.items = [{ product_id: PRODUCT_A.id, quantity: 5 }];
  server.version = 2;

  const { store, engine } = await loadCart();
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 3);
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_B), 1);

  await engine.hydrateCartForCustomer('cust-1');

  const items = store.useCartStore.getState().items;
  expect(quantityOf(items, PRODUCT_A.id)).toBe(5);   // max(3, 5) e non 8
  expect(quantityOf(items, PRODUCT_B.id)).toBe(1);
  expect(server.items).toContainEqual({ product_id: PRODUCT_B.id, quantity: 1 });
});

test('idratazione con lo stesso proprietario : lo stato server vince sugli articoli già sincronizzati', async () => {
  const { store, engine } = await loadCart();
  // Sessione già sincronizzata su questo device...
  store.useCartStore.setState({
    ownerCustomerId: 'cust-1',
    items: [{ product: cartProduct(PRODUCT_A), quantity: 2 }],
    serverVersion: 2,
  });
  // ...ma nel frattempo l'articolo è stato rimosso da un altro device.
  server.items = [];
  server.version = 3;

  await engine.hydrateCartForCustomer('cust-1');

  // Nessuna "resurrezione" dell'articolo cancellato altrove.
  expect(store.useCartStore.getState().items).toHaveLength(0);
  expect(store.useCartStore.getState().serverVersion).toBe(3);
});

// ─── Sync ──────────────────────────────────────────────────────────────────

test('sync riuscita : versione 1 → 2 e stato canonical dal server', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');
  expect(store.useCartStore.getState().serverVersion).toBe(1);

  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);
  await engine.flushCart();

  const state = store.useCartStore.getState();
  expect(state.serverVersion).toBe(2);
  expect(state.pendingMutations).toHaveLength(0);
  expect(state.syncStatus).toBe('synced');
  expect(state.lastSyncedAt).not.toBeNull();
  expect(server.items).toEqual([{ product_id: PRODUCT_A.id, quantity: 2 }]);
});

test('la UI è aggiornata PRIMA della risposta del server (local-first)', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  const gate: { release: () => void } = { release: () => {} };
  const held = new Promise<void>((resolve) => { gate.release = resolve; });
  const original = server.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    value: async (...args: Parameters<typeof original>) => {
      await held;
      return original(...args);
    },
    configurable: true, writable: true,
  });

  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);
  // Nessuna attesa: lo stato locale è già aggiornato.
  expect(quantityOf(store.useCartStore.getState().items, PRODUCT_A.id)).toBe(2);

  const flushing = engine.flushCart();
  await wait(10);
  expect(quantityOf(store.useCartStore.getState().items, PRODUCT_A.id)).toBe(2);
  gate.release();
  await flushing;
  installFetch(server);
});

test('"+" ripetuti producono UNA sola richiesta (debounce + aggregazione)', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');
  const before = server.requests.length;

  for (let i = 0; i < 5; i += 1) store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 1);
  await wait(900); // > debounce

  const posts = server.requests.slice(before).filter((r) => r.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0]!.mutationIds).toHaveLength(1);
  expect(quantityOf(store.useCartStore.getState().items, PRODUCT_A.id)).toBe(5);
  expect(server.items).toEqual([{ product_id: PRODUCT_A.id, quantity: 5 }]);
});

// ─── Errori, retry, offline ────────────────────────────────────────────────

test('errore di rete : le mutation restano in coda, nulla è perso', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  installFailingFetch();
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);
  await engine.flushCart();

  const state = store.useCartStore.getState();
  expect(state.pendingMutations).toHaveLength(1);
  expect(state.pendingMutations[0]!.retryCount).toBe(1);
  expect(quantityOf(state.items, PRODUCT_A.id)).toBe(2); // la UI resta utilizzabile

  // Il retry programmato riesce una volta tornata la rete.
  installFetch(server);
  await engine.flushCart();
  expect(store.useCartStore.getState().pendingMutations).toHaveLength(0);
  expect(server.items).toEqual([{ product_id: PRODUCT_A.id, quantity: 2 }]);
});

test('un 500 è ritentato e finisce per riuscire', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  server.failNext = 1;
  server.failStatus = 500;
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 1);
  await engine.flushCart();
  expect(store.useCartStore.getState().pendingMutations).toHaveLength(1);

  await engine.flushCart();
  expect(store.useCartStore.getState().pendingMutations).toHaveLength(0);
  expect(server.items).toEqual([{ product_id: PRODUCT_A.id, quantity: 1 }]);
});

test('offline : il carrello resta utilizzabile, la coda si accumula', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  setOnline(false);
  const requestsBefore = server.requests.length;
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_B), 1);
  await engine.flushCart();

  const state = store.useCartStore.getState();
  expect(state.syncStatus).toBe('offline');
  expect(state.pendingMutations).toHaveLength(2);
  expect(state.items).toHaveLength(2);            // UI intatta
  expect(server.requests.length).toBe(requestsBefore); // nessuna richiesta
});

test('ritorno online : la coda è svuotata e riconciliata', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  setOnline(false);
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);
  await engine.flushCart();
  expect(store.useCartStore.getState().pendingMutations).toHaveLength(1);

  // Nel frattempo un altro device ha aggiunto B.
  server.apply(null, [{ id: 'other-device', type: 'add', productId: PRODUCT_B.id, quantity: 1 }]);

  setOnline(true);
  await engine.handleCartOnline();

  const state = store.useCartStore.getState();
  expect(state.pendingMutations).toHaveLength(0);
  expect(quantityOf(state.items, PRODUCT_A.id)).toBe(2);
  expect(quantityOf(state.items, PRODUCT_B.id)).toBe(1);
  expect(state.syncStatus).toBe('synced');
});

test('la coda è persistita in localStorage (sopravvive a un refresh)', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  setOnline(false);
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);

  const persisted = JSON.parse(globalThis.localStorage.getItem('lepefy-cart') ?? '{}');
  expect(persisted.state.pendingMutations).toHaveLength(1);
  expect(persisted.state.ownerCustomerId).toBe('cust-1');
  setOnline(true);
});

// ─── Conflitto ─────────────────────────────────────────────────────────────

test('409 : riconciliazione senza perdita, poi ritentativo riuscito', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  // Un altro device fa avanzare la versione del server all'insaputa di questo.
  server.apply(null, [{ id: 'other-device', type: 'add', productId: PRODUCT_B.id, quantity: 1 }]);

  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);
  await engine.flushCart();   // → 409, riconciliazione, riprogrammazione
  await wait(400);            // il retry parte 150 ms dopo

  const state = store.useCartStore.getState();
  expect(state.pendingMutations).toHaveLength(0);
  expect(quantityOf(state.items, PRODUCT_A.id)).toBe(2);
  expect(quantityOf(state.items, PRODUCT_B.id)).toBe(1);
  expect(server.items).toHaveLength(2);
});

// ─── Prodotto non disponibile ──────────────────────────────────────────────

test('un prodotto disattivato è segnalato al client, non cancellato in silenzio', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  store.useCartStore.getState().addItem(cartProduct(PRODUCT_INACTIVE), 1);
  await engine.flushCart();

  expect(store.useCartStore.getState().unavailableProductIds).toEqual([PRODUCT_INACTIVE.id]);
});

// ─── Logout ────────────────────────────────────────────────────────────────

test('logout : ultimo flush, poi carrello locale svuotato e coda azzerata', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);

  await engine.resetCartForLogout();

  const state = store.useCartStore.getState();
  expect(state.items).toHaveLength(0);          // nessuna contaminazione guest
  expect(state.pendingMutations).toHaveLength(0);
  expect(state.ownerCustomerId).toBeNull();
  expect(state.serverVersion).toBeNull();
  expect(server.items).toEqual([{ product_id: PRODUCT_A.id, quantity: 2 }]); // nulla perso
});

test('logout offline : la coda resta legata al SUO proprietario', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  setOnline(false);
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);
  await engine.resetCartForLogout();

  const afterLogout = store.useCartStore.getState();
  expect(afterLogout.items).toHaveLength(0);
  expect(afterLogout.pendingMutations).toHaveLength(1);
  expect(afterLogout.ownerCustomerId).toBe('cust-1');

  // Un ALTRO cliente si autentica su questo device: la coda del primo è
  // scartata e non viene MAI inviata sulla sua sessione.
  setOnline(true);
  await engine.hydrateCartForCustomer('cust-2');

  expect(store.useCartStore.getState().ownerCustomerId).toBe('cust-2');
  expect(server.items).toHaveLength(0);
  const postsWithA = server.requests.filter(
    (r) => r.method === 'POST' && JSON.stringify(r.body).includes(PRODUCT_A.id),
  );
  expect(postsWithA).toHaveLength(0);
});

test('lo stesso cliente si riautentica : la sua coda offline riparte', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  setOnline(false);
  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 2);
  await engine.resetCartForLogout();
  setOnline(true);

  await engine.hydrateCartForCustomer('cust-1');

  expect(store.useCartStore.getState().pendingMutations).toHaveLength(0);
  expect(server.items).toEqual([{ product_id: PRODUCT_A.id, quantity: 2 }]);
});

test('401 : la coda è abbandonata, mai inviata sulla sessione successiva', async () => {
  const { store, engine } = await loadCart();
  await engine.hydrateCartForCustomer('cust-1');

  store.useCartStore.getState().addItem(cartProduct(PRODUCT_A), 1);
  server.failNext = 1;
  server.failStatus = 401;
  await engine.flushCart();

  const state = store.useCartStore.getState();
  expect(state.ownerCustomerId).toBeNull();
  expect(state.pendingMutations).toHaveLength(0);
  expect(state.serverVersion).toBeNull();
});
