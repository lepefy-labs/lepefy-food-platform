import { test, expect } from '@playwright/test';
import { prioritizedCatalogIds } from '../../src/lib/catalog/productMerchandising';
import { buildProductsQuery, MAX_EXCLUDED_IDS, parseExcludeParam } from '../../src/lib/catalog/pagination';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

test.describe('Catalogue : produits des blocs exclus avant la découpe en pages', () => {
  const ranked = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

  test('pages pleines, sans trou ni doublon', () => {
    const excluded = ['p2', 'p5'];
    const pages = [0, 2, 4].map((offset) => prioritizedCatalogIds(ranked, [], offset, 2, excluded));
    expect(pages).toEqual([['p1', 'p3'], ['p4', 'p6'], ['p7']]);
    expect(pages.flat()).toEqual(ranked.filter((id) => !excluded.includes(id)));
  });

  test('avec des produits épinglés : épinglés d’abord, exclus retirés aussi des épinglés', () => {
    expect(prioritizedCatalogIds(ranked, ['p6', 'p2'], 0, 3, ['p2', 'p1'])).toEqual(['p6', 'p3', 'p4']);
    // Sans exclusion : comportement d'avant inchangé.
    expect(prioritizedCatalogIds(ranked, ['p6'], 0, 3)).toEqual(['p6', 'p1', 'p2']);
  });

  test('paramètre ?exclude= : UUID seulement, sans doublon, plafonné', () => {
    expect(parseExcludeParam(`${A},${B.toUpperCase()},${A}, pas-un-id ,`)).toEqual([A, B]);
    expect(parseExcludeParam(null)).toEqual([]);
    expect(parseExcludeParam("1');drop table products;--")).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(parseExcludeParam(many.join(','))).toHaveLength(MAX_EXCLUDED_IDS);
  });

  test('requête de repli : exclusion appliquée, toujours sur le tenant', () => {
    const calls: unknown[][] = [];
    const builder: Record<string, (...a: unknown[]) => unknown> = {};
    for (const method of ['select', 'eq', 'in', 'not', 'ilike', 'order']) {
      builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder; };
    }
    const client = { from: (table: string) => { calls.push(['from', table]); return builder; } };
    buildProductsQuery(client as never, 'tenant-1', [{ id: 'cat-1', slug: 'epices' }], { excludeIds: [A, B] });
    expect(calls).toContainEqual(['eq', 'tenant_id', 'tenant-1']);
    expect(calls).toContainEqual(['not', 'id', 'in', `(${A},${B})`]);

    calls.length = 0;
    buildProductsQuery(client as never, 'tenant-1', [{ id: 'cat-1', slug: 'epices' }], { excludeIds: [] });
    expect(calls.some((call) => call[0] === 'not')).toBe(false);
  });
});
