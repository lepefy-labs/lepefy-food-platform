import { test, expect } from '@playwright/test';
import type { createServiceClient } from '../../src/lib/supabase/server';
import { loadOrderOperationPreparation } from '../../src/lib/orders/loadOrderOperationDetail';

type Db = ReturnType<typeof createServiceClient>;

test('an order UUID from another tenant returns no detail or items', async () => {
  const reads: Array<{ table: string; filters: Record<string, string> }> = [];
  const rows: Record<string, Array<Record<string, unknown>>> = {
    orders: [{ id: 'order-1', tenant_id: 'tenant-B', fulfillment_type: 'delivery', status: 'preparing', shipping_details: null }],
    order_items: [{ order_id: 'order-1', tenant_id: 'tenant-B', product_id: 'secret', quantity: 1 }],
  };
  const fake = {
    from(table: string) {
      const filters: Record<string, string> = {};
      const result = () => {
        reads.push({ table, filters: { ...filters } });
        const data = (rows[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
        return { data, error: null };
      };
      const query = {
        select(_fields: string) { return query; },
        eq(key: string, value: string) { filters[key] = value; return query; },
        async maybeSingle() { const found = result(); return { data: found.data[0] ?? null, error: null }; },
        then(resolve: (value: ReturnType<typeof result>) => void) { resolve(result()); },
      };
      return query;
    },
  } as unknown as Db;

  expect(await loadOrderOperationPreparation(fake, 'tenant-A', 'order-1')).toBeNull();
  expect(reads).toEqual([{ table: 'orders', filters: { tenant_id: 'tenant-A', id: 'order-1' } }]);
  const own = await loadOrderOperationPreparation(fake, 'tenant-B', 'order-1');
  expect(own?.items).toHaveLength(1);
  expect(reads[2]).toEqual({ table: 'order_items', filters: { tenant_id: 'tenant-B', order_id: 'order-1' } });
});
