import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { buildProductsQuery } from '../../src/lib/catalog/pagination';

async function requestUrl(categories: { id: string; slug: string }[], filters: { q?: string; category?: string }) {
  let captured = '';
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      captured = String(input);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    } },
  });
  await buildProductsQuery(client as unknown as Parameters<typeof buildProductsQuery>[0], 'tenant-a', categories, filters).range(24, 47);
  return new URL(captured).searchParams;
}

test('text search and pagination retain the server-authorized category boundary', async () => {
  const params = await requestUrl([{ id: 'food-a', slug: 'food' }], { q: 'bag' });
  expect(params.get('tenant_id')).toBe('eq.tenant-a');
  expect(params.get('active')).toBe('eq.true');
  expect(params.get('category_id')).toBe('in.(food-a)');
  expect(params.get('name')).toBe('ilike.%bag%');
  expect(params.get('offset')).toBe('24');
  expect(params.get('limit')).toBe('24');
});

test('an empty authorized scope cannot become an unfiltered product request', async () => {
  const params = await requestUrl([], { q: 'bag' });
  expect(params.get('category_id')).toBe('in.()');
});

test('a foreign category slug cannot widen the catalogue boundary', async () => {
  const params = await requestUrl([{ id: 'food-a', slug: 'food' }], { category: 'foreign-merchandise' });
  expect(params.get('category_id')).toBe('in.(food-a)');
  expect(params.get('tenant_id')).toBe('eq.tenant-a');
});
