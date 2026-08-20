import { test, expect } from '@playwright/test';
import { enqueueMutation, markRetried, removeApplied } from '@/lib/cart/cartQueue';
import type { PendingMutation } from '@/lib/cart/cartTypes';

// Coda di mutation — funzioni pure, nessun I/O.

function build(...inputs: Parameters<typeof enqueueMutation>[1][]): PendingMutation[] {
  return inputs.reduce<PendingMutation[]>((queue, input) => enqueueMutation(queue, input), []);
}

test('cinque "+" sullo stesso prodotto producono UNA sola mutation', async () => {
  const queue = build(
    { type: 'add', productId: 'p1', quantity: 1 },
    { type: 'add', productId: 'p1', quantity: 1 },
    { type: 'add', productId: 'p1', quantity: 1 },
    { type: 'add', productId: 'p1', quantity: 1 },
    { type: 'add', productId: 'p1', quantity: 1 },
  );

  expect(queue).toHaveLength(1);
  expect(queue[0]).toMatchObject({ type: 'add', productId: 'p1', quantity: 5 });
});

test('gli add su prodotti diversi restano distinti', async () => {
  const queue = build(
    { type: 'add', productId: 'p1', quantity: 1 },
    { type: 'add', productId: 'p2', quantity: 2 },
  );
  expect(queue).toHaveLength(2);
});

test('set_quantity sostituisce le mutation pendenti dello stesso prodotto', async () => {
  const queue = build(
    { type: 'add', productId: 'p1', quantity: 3 },
    { type: 'add', productId: 'p2', quantity: 1 },
    { type: 'set_quantity', productId: 'p1', quantity: 7 },
  );

  expect(queue.map((m) => m.type)).toEqual(['add', 'set_quantity']);
  expect(queue[1]).toMatchObject({ productId: 'p1', quantity: 7 });
});

test('un add dopo un set_quantity si somma al set (semantica preservata)', async () => {
  const queue = build(
    { type: 'set_quantity', productId: 'p1', quantity: 4 },
    { type: 'add', productId: 'p1', quantity: 2 },
  );

  expect(queue).toHaveLength(1);
  expect(queue[0]).toMatchObject({ type: 'set_quantity', quantity: 6 });
});

test('remove elimina le mutation pendenti dello stesso prodotto', async () => {
  const queue = build(
    { type: 'add', productId: 'p1', quantity: 3 },
    { type: 'remove', productId: 'p1' },
  );

  expect(queue).toHaveLength(1);
  expect(queue[0]!.type).toBe('remove');
});

test('un add dopo un remove resta una mutation separata (ordine preservato)', async () => {
  const queue = build(
    { type: 'remove', productId: 'p1' },
    { type: 'add', productId: 'p1', quantity: 2 },
  );

  expect(queue.map((m) => m.type)).toEqual(['remove', 'add']);
});

test('clear azzera la coda', async () => {
  const queue = build(
    { type: 'add', productId: 'p1', quantity: 3 },
    { type: 'add', productId: 'p2', quantity: 1 },
    { type: 'clear' },
  );

  expect(queue).toHaveLength(1);
  expect(queue[0]!.type).toBe('clear');
});

test('removeApplied elimina solo le mutation confermate dal server', async () => {
  const queue = build(
    { type: 'add', productId: 'p1', quantity: 1 },
    { type: 'add', productId: 'p2', quantity: 1 },
  );

  const remaining = removeApplied(queue, [queue[0]!.id]);
  expect(remaining).toHaveLength(1);
  expect(remaining[0]!.id).toBe(queue[1]!.id);
});

test('markRetried incrementa il contatore solo per il batch fallito', async () => {
  const queue = build(
    { type: 'add', productId: 'p1', quantity: 1 },
    { type: 'add', productId: 'p2', quantity: 1 },
  );

  const retried = markRetried(queue, [queue[0]!.id]);
  expect(retried[0]!.retryCount).toBe(1);
  expect(retried[1]!.retryCount).toBe(0);
});
