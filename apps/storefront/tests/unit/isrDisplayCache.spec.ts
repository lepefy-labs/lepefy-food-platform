import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  productAvailabilityPaths,
  revalidateOrderProductAvailability,
  revalidateProductAvailability,
  SHOP_DISPLAY_TTL_SECONDS,
} from '@/lib/cache/storefrontCache';

const appFile = (file: string) => readFileSync(path.join(__dirname, '../../src/app', file), 'utf8');

// Pages ISR de la boutique et layouts de leur arbre : Next.js 14 rend une page
// selon la plus courte durée entre son `revalidate` et chaque unstable_cache
// lu pendant le rendu, donc aucun de ces fichiers ne lit une variante courte.
const ISR_PAGES = [
  '(shop)/products/[slug]/page.tsx',
  '(shop)/accueil/page.tsx',
  'card/page.tsx',
  '(shop)/avis/page.tsx',
  '(shop)/politique-confidentialite/page.tsx',
  '(shop)/conditions-generales-vente/page.tsx',
];
const ISR_TREE = [...ISR_PAGES, 'layout.tsx', '(shop)/layout.tsx', 'card/layout.tsx'];

test.describe('ISR display cache', () => {
  test('every shop ISR page regenerates at the display TTL (literal required by Next)', () => {
    expect(SHOP_DISPLAY_TTL_SECONDS).toBe(3600);
    for (const file of ISR_PAGES) {
      expect(appFile(file).match(/^export const revalidate = (\d+);/m)?.[1], file).toBe(String(SHOP_DISPLAY_TTL_SECONDS));
    }
  });

  test('the ISR tree reads only display variants of the cached readers', () => {
    for (const file of ISR_TREE) {
      const source = appFile(file);
      expect(source, file).not.toMatch(/\bgetTenant\(/);
      expect(source, file).not.toMatch(/\bgetTenantServiceState\(/);
      for (const call of source.match(/canUseReviews\([^)]*\)/g) ?? []) expect(call, file).toContain('display: true');
    }
  });

  test('a stock change refreshes the product pages and the showcases that list products', () => {
    expect(productAvailabilityPaths(['koki', 'koki', null, '', 'sauce-verte'])).toEqual(['/products/koki', '/products/sauce-verte', '/accueil', '/card']);
    expect(productAvailabilityPaths([])).toEqual([]);
  });
});

function fakeDb(tables: Record<string, Array<Record<string, unknown>>>, failOn?: string) {
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const db = {
    from(table: string) {
      const query = { table, filters: [] as Array<[string, unknown]> };
      queries.push(query);
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) { query.filters.push([column, value]); return builder; },
        in(column: string, values: unknown[]) { query.filters.push([column, values]); return builder; },
        then(resolve: (value: unknown) => unknown) {
          if (table === failOn) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve);
          const rows = (tables[table] ?? []).filter((row) => query.filters.every(([column, value]) =>
            Array.isArray(value) ? value.includes(row[column]) : row[column] === value));
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, queries };
}

test.describe('targeted product invalidation', () => {
  const tables = {
    order_items: [
      { order_id: 'o1', tenant_id: 't1', product_id: 'p1' },
      { order_id: 'o1', tenant_id: 't1', product_id: 'p2' },
      { order_id: 'o1', tenant_id: 't2', product_id: 'p9' },
    ],
    products: [
      { id: 'p1', tenant_id: 't1', slug: 'koki' },
      { id: 'p2', tenant_id: 't1', slug: 'sauce-verte' },
      { id: 'p9', tenant_id: 't2', slug: 'autre-tenant' },
    ],
  };

  test('reads only the tenant rows and never throws outside a Next request', async () => {
    const { db, queries } = fakeDb(tables);
    // revalidatePath lève hors d'une requête Next : l'erreur est absorbée.
    await expect(revalidateOrderProductAvailability(db, 't1', 'o1')).resolves.toBeUndefined();
    expect(queries.map((q) => q.table)).toEqual(['order_items', 'products']);
    for (const query of queries) expect(query.filters).toContainEqual(['tenant_id', 't1']);
    expect(queries[1]!.filters).toContainEqual(['id', ['p1', 'p2']]);
  });

  test('a database error never reaches the order flow', async () => {
    const { db } = fakeDb(tables, 'products');
    await expect(revalidateProductAvailability(db, 't1', ['p1'])).resolves.toBeUndefined();
    const failing = fakeDb(tables, 'order_items');
    await expect(revalidateOrderProductAvailability(failing.db, 't1', 'o1')).resolves.toBeUndefined();
  });

  test('no product, no query; ids are deduplicated and capped', async () => {
    const empty = fakeDb(tables);
    await revalidateProductAvailability(empty.db, 't1', [null, undefined, '']);
    expect(empty.queries).toEqual([]);
    const many = fakeDb(tables);
    await revalidateProductAvailability(many.db, 't1', [...Array.from({ length: 150 }, (_, i) => `p${i}`), 'p1']);
    const ids = many.queries[0]!.filters.find(([column]) => column === 'id')![1] as string[];
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
  });
});
