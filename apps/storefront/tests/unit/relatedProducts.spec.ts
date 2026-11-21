import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { getRelatedProducts } from '../../src/lib/catalog/getRelatedProducts';

const source = { id: 'source', category_id: 'category-a' };
const tenant = { id: 'tenant-a', ai_semantic_search: true };
function product(id: string, stock = 5) {
  return { id, name: id, slug: id, price: 5, stock, image_url: null, weight_grams: null, storage_type: 'dry', category_name: 'Food', min_order_quantity: 1, order_quantity_step: 1 };
}

function fixture(options: { embedding?: unknown; semantic?: unknown[]; rpcError?: boolean; fallback?: unknown[]; cards?: unknown[]; cardsError?: boolean } = {}) {
  const calls: { url: URL; body: Record<string, unknown> | null }[] = [];
  const client = createClient('https://example.supabase.co', 'test-key', {
    realtime: { transport: class OfflineWebSocket { constructor() { throw new Error('REST only'); } } as never },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const rpc = url.pathname.includes('/rpc/');
      // Cards des résultats sémantiques : relues par id avec la projection partagée.
      const idFilter = url.searchParams.get('id');
      if (!rpc && idFilter?.startsWith('in.')) {
        const ids = idFilter.slice(4, -1).split(',');
        const rows = ((options.cards ?? options.semantic ?? []) as { id: string; stock: number }[])
          .filter((row) => ids.includes(row.id) && row.stock !== 0)
          .reverse(); // ordre de la base, pas celui de la similarité
        return new Response(JSON.stringify(options.cardsError ? { message: 'Unavailable' } : rows), { status: options.cardsError ? 500 : 200, headers: { 'content-type': 'application/json' } });
      }
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
  const cards = calls[2]!.url.searchParams;
  expect(cards.get('id')).toBe('in.(semantic)');
  expect(cards.get('tenant_id')).toBe('eq.tenant-a');
  expect(cards.get('format_parent_id')).toBe('is.null');
  expect(cards.get('select')).toContain('formats:sale_formats(');
  const fallback = calls[3]!.url.searchParams;
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

test('la règle de quantité minimale est propagée depuis les deux branches (sémantique et repli catégorie)', async () => {
  const { client } = fixture({
    embedding: [0.1],
    semantic: [{ ...product('semantic'), min_order_quantity: 4, order_quantity_step: 1 }],
    fallback: [{ ...product('fallback'), min_order_quantity: 2, order_quantity_step: 1 }],
  });
  const result = await getRelatedProducts(client, tenant, source, 4);
  expect(result).toEqual([
    expect.objectContaining({ id: 'semantic', min_order_quantity: 4, order_quantity_step: 1 }),
    expect.objectContaining({ id: 'fallback', min_order_quantity: 2, order_quantity_step: 1 }),
  ]);
});

test('les cards sémantiques gardent l’ordre de similarité et portent leurs formats de vente', async () => {
  const formats = [{ id: 'lot', units_per_sale: 4, format_label: 'Lot de 4', price: 12, active: true }];
  const { client } = fixture({
    embedding: [0.1],
    semantic: [product('a'), product('b')],
    cards: [{ ...product('a'), formats }, { ...product('b'), formats: [] }],
  });
  const result = await getRelatedProducts(client, tenant, source, 2);
  expect(result.map((p) => p.id)).toEqual(['a', 'b']);
  expect(result[0]!.formats).toEqual(formats);
});

test('lecture des cards sémantiques en échec : repli catégorie', async () => {
  const { client } = fixture({ embedding: [0.1], semantic: [product('a')], cardsError: true, fallback: [product('fallback')] });
  expect((await getRelatedProducts(client, tenant, source, 4)).map((p) => p.id)).toEqual(['fallback']);
});

test('malformed embedding and empty category results are a valid empty enhancement', async () => {
  const { client } = fixture({ embedding: 'not-json' });
  expect(await getRelatedProducts(client, tenant, source, 4)).toEqual([]);
});
