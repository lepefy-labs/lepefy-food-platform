import { test, expect } from '@playwright/test';
import { parseSyncRequest, parseLegacyPutBody } from '@/lib/cart/cartRequest';

// Validazione del payload lato server (usata dalla route handler).

test('un payload valido è accettato', async () => {
  const parsed = parseSyncRequest({
    expectedVersion: 4,
    mutations: [
      { id: 'm1', type: 'add', productId: 'p1', quantity: 2 },
      { id: 'm2', type: 'set_quantity', productId: 'p2', quantity: 0 },
      { id: 'm3', type: 'remove', productId: 'p3' },
      { id: 'm4', type: 'clear' },
    ],
  });

  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.expectedVersion).toBe(4);
  expect(parsed.mutations).toHaveLength(4);
});

test('expectedVersion può essere assente (primo sync)', async () => {
  const parsed = parseSyncRequest({ mutations: [] });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.expectedVersion).toBeNull();
});

test('TENANT ISOLATION : tenantId e customerId inviati dal client sono ignorati', async () => {
  const parsed = parseSyncRequest({
    expectedVersion: 1,
    tenantId:   'tenant-de-quelqun-dautre',
    customerId: 'client-de-quelqun-dautre',
    mutations: [
      { id: 'm1', type: 'add', productId: 'p1', quantity: 1,
        tenantId: 'tenant-x', customerId: 'client-y' },
    ],
  });

  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  // Nessuna identità sopravvive al parsing: la route la deriva dalla sessione.
  const serialized = JSON.stringify(parsed);
  expect(serialized).not.toContain('tenant');
  expect(serialized).not.toContain('client-y');
  expect(parsed.mutations[0]).toEqual({ id: 'm1', type: 'add', productId: 'p1', quantity: 1 });
});

test('una mutation senza id è rifiutata (idempotenza impossibile)', async () => {
  const parsed = parseSyncRequest({ mutations: [{ type: 'add', productId: 'p1', quantity: 1 }] });
  expect(parsed.ok).toBe(false);
});

test('un tipo di mutation sconosciuto è rifiutato', async () => {
  const parsed = parseSyncRequest({ mutations: [{ id: 'm1', type: 'drop_table', productId: 'p1' }] });
  expect(parsed.ok).toBe(false);
});

test('una quantità non valida produce INVALID_QUANTITY', async () => {
  for (const quantity of [-1, 1.5, 1000, 'trois']) {
    const parsed = parseSyncRequest({
      mutations: [{ id: 'm1', type: 'set_quantity', productId: 'p1', quantity }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe('INVALID_QUANTITY');
  }
});

test('un add di quantità 0 è rifiutato', async () => {
  const parsed = parseSyncRequest({
    mutations: [{ id: 'm1', type: 'add', productId: 'p1', quantity: 0 }],
  });
  expect(parsed.ok).toBe(false);
});

test('un batch smisurato è rifiutato', async () => {
  const mutations = Array.from({ length: 101 }, (_, i) => ({
    id: `m${i}`, type: 'add', productId: 'p1', quantity: 1,
  }));
  const parsed = parseSyncRequest({ mutations });
  expect(parsed.ok).toBe(false);
});

test('il PUT legacy continua a scartare in silenzio le righe non valide', async () => {
  const parsed = parseLegacyPutBody({
    items: [
      { productId: 'p1', quantity: 2 },
      { productId: '',   quantity: 2 },
      { productId: 'p2', quantity: 0 },
      { productId: 'p3', quantity: 1.5 },
      { productId: 'p4', quantity: 1 },
    ],
  });

  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.items).toEqual([
    { productId: 'p1', quantity: 2 },
    { productId: 'p4', quantity: 1 },
  ]);
  expect(parsed.expectedVersion).toBeNull();
});
