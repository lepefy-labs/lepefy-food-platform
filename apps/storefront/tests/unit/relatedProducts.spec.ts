import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { getRelatedProducts } from '../../src/lib/catalog/getRelatedProducts';

const source = { id: 'source', category_id: 'category-a' };
const tenant = { id: 'tenant-a', ai_semantic_search: true };
function product(id: string, stock = 5) {
  return { id, name: id, slug: id, price: 5, stock, image_url: null, weight_grams: null, storage_type: 'dry', category_name: 'Food' };
}

function fixture(options: { embedding?: unknown; semantic?: unknown[]; rpcError?: boolean; fallback?: unknown[] } = {}) {
  const calls: { url: URL; body: Record<string, unknown> | null }[] = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    realtime: { transport: class OfflineWebSocket { constructor() { throw new Error('REST only'); } } as never },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const rpc = url.pathname.includes('/rpc/');
      const data = rpc ? options.rpcError ? { message: 'Unavailable' } : options.semantic ?? []
        : url.searchParams.get('select') === 'embedding' ? { embedding: options.embedding ?? null } : options.fallback ?? [];
      return new Response(JSON.stringify(data), { status: rpc && options.rpcError ? 500 : 200, headers: { 'content-type': 'application/json' } });
    } },
  });
  return { client: client as unknown as Parameters<typeof getRelatedProducts>[0], calls };
}

test('semantic order is retained, self and stock zero removed, category fills remaining slots', async () => {
  const { client, calls } = fixture({ embedding: '[0.1,0.2]', semantic: [product('source'), product('sold', 0), product('semantic')], fallback: [product('fallback')] });
  const result = await getRelatedProducts(client, tenant, source, 4);
  expect(result.map(p => p.id)).toEqual(['semantic', 'fallback']);
  expect(calls[0]!.url.searchParams.get('tenant_id')).toBe('eq.tenant-a');
  expect(calls[0]!.url.searchParams.get('active')).toBe('eq.true');
  expect(calls[1]!.body).toMatchObject({ query_embedding: [0.1, 0.2], p_tenant_id: 'tenant-a', match_count: 5, min_similarity: 0.35 });
  const fallback = calls[2]!.url.searchParams;
  expect(fallback.get('tenant_id')).toBe('eq.tenant-a');
  expect(fallback.get('active')).toBe('eq.true');
  expect(fallback.get('stock')).toBe('neq.0');
  expect(fallback.get('category_id')).toBe('eq.category-a');
  expect(fallback.get('id')).toBe('not.in.(source,semantic)');
  expect(fallback.get('limit')).toBe('3');
});

test('failed semantic RPC falls back without losing the category or tenant boundary', async () => {
  const { client, calls } = fixture({ embedding: [0.1], rpcError: true, fallback: [product('fallback')] });
  expect((await getRelatedProducts(client, tenant, source, 4)).map(p => p.id)).toEqual(['fallback']);
  expect(calls.at(-1)!.url.searchParams.get('category_id')).toBe('eq.category-a');
  expect(calls.at(-1)!.url.searchParams.get('tenant_id')).toBe('eq.tenant-a');
});

test('missing embedding uses category and disabled semantic search never calls the RPC', async () => {
  for (const ai_semantic_search of [true, false]) {
    const { client, calls } = fixture({ fallback: [product('fallback')] });
    expect(await getRelatedProducts(client, { ...tenant, ai_semantic_search }, source)).toHaveLength(1);
    expect(calls.some(call => call.url.pathname.includes('/rpc/'))).toBe(false);
    expect(calls.at(-1)!.url.searchParams.get('limit')).toBe('8');
  }
});

test('product detail retains eight suggestions while popup is capped at four', async () => {
  const products = Array.from({ length: 12 }, (_, i) => product('p' + i));
  const { client } = fixture({ embedding: [0.1], semantic: products });
  expect(await getRelatedProducts(client, tenant, source)).toHaveLength(8);
  expect(await getRelatedProducts(client, tenant, source, 4)).toHaveLength(4);
});

test('malformed embedding and empty category results are a valid empty enhancement', async () => {
  const { client } = fixture({ embedding: 'not-json' });
  expect(await getRelatedProducts(client, tenant, source, 4)).toEqual([]);
});
