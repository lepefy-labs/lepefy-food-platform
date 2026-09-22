import { expect, test } from '@playwright/test';
import { validateCheckoutItems } from '../../src/lib/checkout/validateCheckoutItems';

interface ProductRow {
  id: string; name: string; price: number; storage_type: null; stock: number;
  min_order_quantity: number; order_quantity_step: number;
}
interface GroupRow {
  id: string; name: string; min_quantity: number; quantity_step: number;
  purchase_quantity_group_products: Array<{ product_id: string }>;
}
function fakeClient(
  products: ProductRow[],
  groups: GroupRow[] = [],
  groupError = false,
): Parameters<typeof validateCheckoutItems>[0] {
  return {
    from(table: string) {
      const result = table === 'products'
        ? { data: products, error: null }
        : groupError
          ? { data: null, error: { message: 'db unavailable' } }
          : { data: groups, error: null };
      const query = {
        select() { return query; },
        eq() { return query; },
        in() { return Promise.resolve(result); },
        then(onFulfilled: (result: typeof result) => unknown) { return Promise.resolve(result).then(onFulfilled); },
      };
      return query;
    },
  } as unknown as Parameters<typeof validateCheckoutItems>[0];
}
const ndole: ProductRow = {
  id: 'ndole', name: 'Ndolé', price: 2, storage_type: null,
  stock: 16, min_order_quantity: 4, order_quantity_step: 4,
};
const coca: ProductRow = {
  id: 'coca', name: 'Coca', price: 1, storage_type: null,
  stock: 24, min_order_quantity: 1, order_quantity_step: 1,
};
const boissons: GroupRow = {
  id: 'boissons', name: 'Boissons', min_quantity: 12, quantity_step: 6,
  purchase_quantity_group_products: [{ product_id: 'coca' }],
};

test('recovery rejects a previously saved quantity after admin raises the product minimum', async () => {
  const result = await validateCheckoutItems(fakeClient([ndole]), 'tenant-a', [{ productId: 'ndole', quantity: 2 }]);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.body.code).toBe('QUANTITY_RULE_VIOLATION');
    expect(result.body.violations?.[0]?.type).toBe('PRODUCT_MINIMUM');
  }
});

test('recovery rejects a newly active or raised group rule', async () => {
  const result = await validateCheckoutItems(fakeClient([coca], [boissons]), 'tenant-a', [
    { productId: 'coca', quantity: 6 },
  ]);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.body.violations?.[0]?.type).toBe('GROUP_MINIMUM');
});

test('recovery refuses a stock drop despite a valid step', async () => {
  const result = await validateCheckoutItems(
    fakeClient([{ ...ndole, stock: 6 }]), 'tenant-a',
    [{ productId: 'ndole', quantity: 8 }],
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.body.code).toBe('INSUFFICIENT_STOCK');
});

test('checkout validates the free mix and returns canonical prices', async () => {
  const result = await validateCheckoutItems(
    fakeClient([ndole, coca], [boissons]), 'tenant-a',
    [{ productId: 'ndole', quantity: 4 }, { productId: 'coca', quantity: 12 }],
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.items).toHaveLength(2);
    expect(result.quantityByProduct.get('coca')).toBe(12);
    expect(result.items[0]?.price).toBe(2);
  }
});

test('missing group DB data fails closed rather than treating it as an empty list', async () => {
  const result = await validateCheckoutItems(
    fakeClient([coca], [], true), 'tenant-a',
    [{ productId: 'coca', quantity: 1 }],
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.body.code).toBe('SERVER_ERROR');
});

test('duplicate lines cannot bypass product and stock constraints', async () => {
  const result = await validateCheckoutItems(fakeClient([ndole]), 'tenant-a', [
    { productId: 'ndole', quantity: 8 },
    { productId: 'ndole', quantity: 8 },
    { productId: 'ndole', quantity: 8 },
  ]);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.body.code).toBe('INSUFFICIENT_STOCK');
});
