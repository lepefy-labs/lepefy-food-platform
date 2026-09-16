import { expect, test } from '@playwright/test';
import { loadHeroGallery } from '../../src/lib/events/loadHeroGallery';

function fakeClient(failEditorial = false) {
  const queries: { table: string; filters: [string, unknown][]; orders: string[]; limit?: number }[] = [];
  const client = {
    from(table: string) {
      const query = { table, filters: [] as [string, unknown][], orders: [] as string[], limit: undefined as number | undefined };
      queries.push(query);
      const builder = {
        select() { return builder; },
        eq(field: string, value: unknown) { query.filters.push([field, value]); return builder; },
        is(field: string, value: unknown) { query.filters.push([field, value]); return builder; },
        order(field: string) { query.orders.push(field); return builder; },
        limit(value: number) {
          query.limit = value;
          const category = query.filters.find(([field]) => field === 'category')?.[1];
          return Promise.resolve(failEditorial && category
            ? { data: null, error: { code: '42703', message: 'category does not exist' } }
            : { data: [{ id: category ?? 'legacy', event_id: null, image_url: 'https://images.example/' + (category ?? 'legacy') }], error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as Parameters<typeof loadHeroGallery>[0], queries };
}

test('editorial queries are tenant-scoped, independently bounded and deterministic', async () => {
  const { client, queries } = fakeClient();
  expect(await loadHeroGallery(client, 'tenant-a', ['traiteur', 'ambiance', 'general'])).toHaveLength(3);
  for (const query of queries) {
    expect(query.table).toBe('event_gallery_photos');
    expect(query.filters).toContainEqual(['tenant_id', 'tenant-a']);
    expect(query.limit).toBe(6);
    expect(query.orders).toEqual(['hero_eligible', 'hero_priority', 'sort_order', 'created_at', 'id']);
  }
  expect(queries[1]?.filters).toContainEqual(['event_id', null]);
  expect(queries[2]?.filters).toContainEqual(['event_id', null]);
});

test('a schema unavailable during rollout retries a bounded legacy gallery query', async () => {
  const { client, queries } = fakeClient(true);
  expect(await loadHeroGallery(client, 'tenant-b', ['traiteur', 'general'])).toEqual([{ id: 'legacy', event_id: null, image_url: 'https://images.example/legacy' }]);
  expect(queries).toHaveLength(3);
  expect(queries[2]?.filters).toEqual([['tenant_id', 'tenant-b'], ['event_id', null]]);
  expect(queries[2]?.limit).toBe(6);
});

test('no requested candidates do not trigger a gallery fetch', async () => {
  const { client, queries } = fakeClient();
  expect(await loadHeroGallery(client, 'tenant-a', [])).toEqual([]);
  expect(queries).toEqual([]);
});
