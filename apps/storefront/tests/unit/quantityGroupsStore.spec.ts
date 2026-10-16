import { expect, test } from '@playwright/test';
import type { PublicQuantityGroup } from '@/app/api/quantity-groups/route';
import { createQuantityGroupsStore, readQuantityGroupsResponse } from '@/lib/cart/quantityGroupsStore';
import { QUANTITY_GROUPS_CACHE_CONTROL, QUANTITY_GROUPS_ERROR_CACHE_CONTROL } from '@/lib/cart/quantityGroupsHttp';
import { computeQuantityRuleState, stepPurchaseQuantity, validatePurchaseQuantityRules } from '@/lib/purchaseQuantityRules';

const drinks: PublicQuantityGroup = { id: 'g-drinks', name: 'Boissons', min_quantity: 12, quantity_step: 1, productIds: ['p-cola', 'p-malta'] };

function setup(responses: Array<PublicQuantityGroup[] | Error>, ttlMs = 60_000) {
  let clock = 1_000;
  const calls: number[] = [];
  const pending: Array<() => void> = [];
  const store = createQuantityGroupsStore({
    fetcher: () => {
      calls.push(clock);
      const next = responses.shift() ?? [];
      return new Promise<PublicQuantityGroup[]>((resolve, reject) => {
        pending.push(() => (next instanceof Error ? reject(next) : resolve(next)));
      });
    },
    now: () => clock,
    ttlMs,
    errorRetryMs: 10_000,
    errorMessage: 'Règles indisponibles',
  });
  const flush = async () => { while (pending.length) pending.shift()!(); await new Promise(r => setTimeout(r, 0)); };
  return { store, calls, flush, advance: (ms: number) => { clock += ms; } };
}

test.describe('quantity groups store', () => {
  test('simultaneous consumers share one request', async () => {
    const { store, calls, flush } = setup([[drinks]]);
    // Cart drawer, product page, cart gate and Nala mounting together.
    const loads = [store.ensure('chloefood'), store.ensure('chloefood'), store.ensure('chloefood'), store.ensure('chloefood')];
    expect(calls).toHaveLength(1);
    expect(store.getSnapshot('chloefood').status).toBe('loading');
    await flush();
    await Promise.all(loads);
    expect(store.getSnapshot('chloefood')).toEqual({ groups: [drinks], status: 'ready', error: null });
  });

  test('a loaded rule set is reused during the TTL, refreshed after it', async () => {
    const changed = { ...drinks, min_quantity: 6 };
    const { store, calls, flush, advance } = setup([[drinks], [changed]]);
    void store.ensure('chloefood'); await flush();
    advance(59_000);
    await store.ensure('chloefood');
    expect(calls).toHaveLength(1);
    advance(2_000);
    void store.ensure('chloefood');
    expect(calls).toHaveLength(2);
    // During the refresh the last known rules stay visible (no "loading" flash, no empty set).
    expect(store.getSnapshot('chloefood')).toMatchObject({ status: 'ready', groups: [drinks] });
    await flush();
    expect(store.getSnapshot('chloefood').groups[0]!.min_quantity).toBe(6);
  });

  test('a failure is an error, never an empty rule set, and retries are bounded', async () => {
    const { store, calls, flush, advance } = setup([new Error('503'), [drinks]]);
    void store.ensure('chloefood'); await flush();
    expect(store.getSnapshot('chloefood')).toEqual({ groups: [], status: 'error', error: 'Règles indisponibles' });
    // Components remounting right away do not hammer the API.
    await store.ensure('chloefood'); await store.ensure('chloefood');
    expect(calls).toHaveLength(1);
    advance(10_000);
    void store.ensure('chloefood'); await flush();
    expect(calls).toHaveLength(2);
    expect(store.getSnapshot('chloefood').status).toBe('ready');
  });

  test('« Réessayer » (invalidate) always requests again, even within the TTL', async () => {
    const deleted: PublicQuantityGroup[] = [];
    const { store, calls, flush } = setup([[drinks], deleted]);
    void store.ensure('chloefood'); await flush();
    void store.invalidate('chloefood');
    expect(calls).toHaveLength(2);
    await flush();
    // Group deleted by the admin: the cart no longer applies it.
    expect(store.getSnapshot('chloefood')).toEqual({ groups: [], status: 'ready', error: null });
  });

  test('a failed refresh keeps the last known rules', async () => {
    const { store, flush, advance } = setup([[drinks], new Error('timeout')]);
    void store.ensure('chloefood'); await flush();
    advance(61_000);
    void store.ensure('chloefood'); await flush();
    expect(store.getSnapshot('chloefood')).toEqual({ groups: [drinks], status: 'ready', error: null });
  });

  test('two tenants never share an entry', async () => {
    const other: PublicQuantityGroup = { ...drinks, id: 'g-other', min_quantity: 24, productIds: ['p-x'] };
    const { store, calls, flush } = setup([[drinks], [other]]);
    void store.ensure('chloefood'); void store.ensure('lepefy-test'); await flush();
    expect(calls).toHaveLength(2);
    expect(store.getSnapshot('chloefood').groups).toEqual([drinks]);
    expect(store.getSnapshot('lepefy-test').groups).toEqual([other]);
  });

  test('listeners are notified and the number of scopes stays bounded', async () => {
    const { store, flush } = setup([[drinks], [], [], [], [], []]);
    let notified = 0;
    const unsubscribe = store.subscribe('chloefood', () => { notified += 1; });
    void store.ensure('chloefood'); await flush();
    expect(notified).toBe(2); // loading, ready
    unsubscribe();
    for (const scope of ['a', 'b', 'c', 'd', 'e']) { void store.ensure(scope); await flush(); }
    expect(store.scopeCount()).toBeLessThanOrEqual(4);
  });

  test('the response parser rejects failures and malformed payloads', async () => {
    await expect(readQuantityGroupsResponse(new Response('{"groups":[]}', { status: 503 }))).rejects.toThrow();
    await expect(readQuantityGroupsResponse(new Response('{"nope":1}'))).rejects.toThrow();
    await expect(readQuantityGroupsResponse(new Response(JSON.stringify({ groups: [drinks] })))).resolves.toEqual([drinks]);
  });

  test('HTTP caching: shared CDN cache for the public payload, never for errors', () => {
    expect(QUANTITY_GROUPS_CACHE_CONTROL).toMatch(/^public, s-maxage=\d+/);
    expect(QUANTITY_GROUPS_CACHE_CONTROL).not.toMatch(/private|max-age=(?!\d+, )/);
    expect(QUANTITY_GROUPS_ERROR_CACHE_CONTROL).toBe('no-store');
  });
});

test.describe('quantity rules stay those of the shared engine', () => {
  test('first add uses the product minimum, then its step', () => {
    expect(stepPurchaseQuantity(0, 4, 1, 50, 'increment')).toBe(4);
    expect(stepPurchaseQuantity(0, 2, 1, 50, 'increment')).toBe(2);
    expect(stepPurchaseQuantity(0, 6, 3, 50, 'increment')).toBe(6);
    expect(stepPurchaseQuantity(6, 6, 3, 50, 'increment')).toBe(9);
    expect(stepPurchaseQuantity(6, 6, 3, 50, 'decrement')).toBe(0);
    expect(computeQuantityRuleState(7, 6, 3).isValid).toBe(false);
  });

  test('a combinable group is checked on the total of its members (the server rule)', () => {
    const products = ['p-cola', 'p-malta'].map(id => ({ id, name: id, min_order_quantity: 1, order_quantity_step: 1 }));
    const short = new Map([['p-cola', 5], ['p-malta', 4]]);
    expect(validatePurchaseQuantityRules(short, products, [drinks]).map(v => v.type)).toEqual(['GROUP_MINIMUM']);
    const enough = new Map([['p-cola', 8], ['p-malta', 4]]);
    expect(validatePurchaseQuantityRules(enough, products, [drinks])).toHaveLength(0);
    // Group tightened by the admin after the client cached it: the rule applied is the one passed in.
    expect(validatePurchaseQuantityRules(enough, products, [{ ...drinks, min_quantity: 24 }]).map(v => v.type)).toEqual(['GROUP_MINIMUM']);
  });
});
