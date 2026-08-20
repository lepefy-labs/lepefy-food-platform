import { test, expect } from '@playwright/test';
import { enqueueMutation, removeApplied } from '@/lib/cart/cartQueue';
import { reconcileCart } from '@/lib/cart/reconcile';
import type { CartMutationInput, PendingMutation } from '@/lib/cart/cartTypes';
import type { CartItem } from '@lepefy/types';
import { FakeCartServer } from './helpers/fakeCartServer';
import { ALL_PRODUCTS, quantityOf, PRODUCT_A, PRODUCT_B } from './helpers/cartFixtures';

// SCENARIO CRITICO (§31 della specifica) — due device reali, ciascuno con il
// proprio stato locale e la propria coda, che parlano allo stesso carrello
// server.
//
// `Device` riproduce esattamente l'algoritmo del sync engine (accodamento →
// invio con expectedVersion → in caso di 409 riconciliazione + ritentativo)
// usando gli STESSI moduli puri. Serve a poter istanziare due client
// indipendenti, cosa impossibile con lo store zustand che è un singleton.

class Device {
  items: CartItem[] = [];
  queue: PendingMutation[] = [];
  serverVersion: number | null = null;

  constructor(private readonly server: FakeCartServer, readonly name: string) {}

  /** GET iniziale — login su questo device. */
  hydrate(): void {
    this.items         = this.server.apply(null, []).items;
    this.serverVersion = this.server.version;
  }

  /** Azione utente: stato locale aggiornato subito, mutation accodata. */
  act(input: CartMutationInput): void {
    this.queue = enqueueMutation(this.queue, input);
    this.items = reconcileCart(this.items, this.items, [this.queue[this.queue.length - 1]!]);
  }

  /** Un tentativo di sync. Ritorna true se il batch è stato applicato. */
  syncOnce(): boolean {
    if (this.queue.length === 0) return true;
    const result = this.server.apply(this.serverVersion, this.queue.map((m) => ({
      id: m.id,
      type: m.type,
      productId: m.type === 'clear' ? undefined : m.productId,
      quantity: m.type === 'add' || m.type === 'set_quantity' ? m.quantity : undefined,
    })));

    if (result.status === 'conflict') {
      // Riconciliazione: stato canonical + mutation ancora pendenti sopra.
      this.items         = reconcileCart(result.items, this.items, this.queue);
      this.serverVersion = result.version;
      return false;
    }

    this.queue         = removeApplied(this.queue, result.appliedMutationIds);
    this.items         = reconcileCart(result.items, this.items, this.queue);
    this.serverVersion = result.version;
    return true;
  }

  /** Sync con ritentativi, come fa il sync engine dopo un 409. */
  sync(maxAttempts = 3): void {
    for (let i = 0; i < maxAttempts; i += 1) if (this.syncOnce()) return;
    throw new Error(`${this.name}: sync non convergente`);
  }
}

test('due device aggiungono prodotti diversi in concorrenza : entrambi preservati', async () => {
  const server = new FakeCartServer(ALL_PRODUCTS);
  const deviceA = new Device(server, 'A');
  const deviceB = new Device(server, 'B');

  deviceA.hydrate();
  deviceB.hydrate();
  expect(deviceA.serverVersion).toBe(1);
  expect(deviceB.serverVersion).toBe(1);

  deviceA.act({ type: 'add', productId: PRODUCT_A.id, quantity: 1 });
  deviceB.act({ type: 'add', productId: PRODUCT_B.id, quantity: 1 });

  deviceA.sync();          // passa per primo
  deviceB.sync();          // riceve 409, riconcilia, ritenta

  expect(server.items).toHaveLength(2);
  expect(server.items.map((i) => i.product_id).sort()).toEqual([PRODUCT_A.id, PRODUCT_B.id].sort());
  expect(quantityOf(deviceB.items, PRODUCT_A.id)).toBe(1);
  expect(quantityOf(deviceB.items, PRODUCT_B.id)).toBe(1);
});

test('due device aggiungono LO STESSO prodotto : gli incrementi si sommano', async () => {
  const server = new FakeCartServer(ALL_PRODUCTS);
  const deviceA = new Device(server, 'A');
  const deviceB = new Device(server, 'B');

  deviceA.hydrate();
  deviceB.hydrate();

  deviceA.act({ type: 'add', productId: PRODUCT_A.id, quantity: 1 });
  deviceB.act({ type: 'add', productId: PRODUCT_A.id, quantity: 1 });

  deviceA.sync();
  deviceB.sync();

  // `add` è relativo: nessuno dei due "+1" viene perso.
  expect(server.items).toEqual([{ product_id: PRODUCT_A.id, quantity: 2 }]);
});

test('quantity conflict : due set_quantity concorrenti, risoluzione deterministica', async () => {
  // §19/§31 — A imposta 2, B imposta 5. Non si sommano MAI (≠ 7). La risoluzione
  // è: l'ultima intenzione esplicita realmente sincronizzata è quella che vale,
  // e il device perdente apprende immediatamente lo stato canonical.
  const server = new FakeCartServer(ALL_PRODUCTS);
  server.apply(null, [{ id: 'seed', type: 'set_quantity', productId: PRODUCT_A.id, quantity: 1 }]);

  const deviceA = new Device(server, 'A');
  const deviceB = new Device(server, 'B');
  deviceA.hydrate();
  deviceB.hydrate();

  deviceA.act({ type: 'set_quantity', productId: PRODUCT_A.id, quantity: 2 });
  deviceB.act({ type: 'set_quantity', productId: PRODUCT_A.id, quantity: 5 });

  deviceA.sync();
  expect(server.items).toEqual([{ product_id: PRODUCT_A.id, quantity: 2 }]);

  deviceB.sync();  // 409 → riconcilia → riapplica il PROPRIO set esplicito
  expect(server.items).toEqual([{ product_id: PRODUCT_A.id, quantity: 5 }]);
  expect(quantityOf(deviceB.items, PRODUCT_A.id)).toBe(5);

  // Nessuna somma silenziosa.
  expect(server.items[0]!.quantity).not.toBe(7);

  // Il device A apprende lo stato canonical al ritorno sulla tab.
  const canonical = server.apply(null, []);
  deviceA.items = reconcileCart(canonical.items, deviceA.items, deviceA.queue);
  expect(quantityOf(deviceA.items, PRODUCT_A.id)).toBe(5);
});

test('scenario completo §17 : A ajoute, B ajoute, A retourne sur l\'onglet', async () => {
  const server = new FakeCartServer(ALL_PRODUCTS);
  const deviceA = new Device(server, 'A');
  const deviceB = new Device(server, 'B');

  // DEVICE A : login, carrello vuoto, add A → version 2
  deviceA.hydrate();
  deviceA.act({ type: 'add', productId: PRODUCT_A.id, quantity: 1 });
  deviceA.sync();
  expect(server.version).toBe(2);

  // DEVICE B : login, GET → version 2, contiene A
  deviceB.hydrate();
  expect(deviceB.serverVersion).toBe(2);
  expect(quantityOf(deviceB.items, PRODUCT_A.id)).toBe(1);

  // DEVICE B : add B → version 3
  deviceB.act({ type: 'add', productId: PRODUCT_B.id, quantity: 1 });
  deviceB.sync();
  expect(server.version).toBe(3);

  // DEVICE A : ritorno sulla tab → reconcile → contiene A e B
  const canonical = server.apply(null, []);
  deviceA.items         = reconcileCart(canonical.items, deviceA.items, deviceA.queue);
  deviceA.serverVersion = canonical.version;

  expect(deviceA.items).toHaveLength(2);
  expect(quantityOf(deviceA.items, PRODUCT_A.id)).toBe(1);
  expect(quantityOf(deviceA.items, PRODUCT_B.id)).toBe(1);
});

test('modifiche offline su un device, mentre l\'altro modifica online : nulla si perde', async () => {
  const server = new FakeCartServer(ALL_PRODUCTS);
  const deviceA = new Device(server, 'A');
  const deviceB = new Device(server, 'B');
  deviceA.hydrate();
  deviceB.hydrate();

  // A è offline: accumula due azioni senza sincronizzare.
  deviceA.act({ type: 'add', productId: PRODUCT_A.id, quantity: 2 });
  deviceA.act({ type: 'add', productId: PRODUCT_A.id, quantity: 1 });
  expect(deviceA.queue).toHaveLength(1);        // aggregate in una sola mutation

  // B, online, aggiunge un altro prodotto.
  deviceB.act({ type: 'add', productId: PRODUCT_B.id, quantity: 4 });
  deviceB.sync();

  // A torna online.
  deviceA.sync();

  expect(quantityOf(deviceA.items, PRODUCT_A.id)).toBe(3);
  expect(quantityOf(deviceA.items, PRODUCT_B.id)).toBe(4);
  expect(server.items).toHaveLength(2);
});
