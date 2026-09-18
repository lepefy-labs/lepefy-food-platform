import { test, expect } from '@playwright/test';
import { parseCompareAtPrice, parseCatalogPosition, prioritizedCatalogIds } from '../../src/lib/catalog/productMerchandising';

test('discount accepts the carton offer and rejects invalid comparisons', () => {
  expect(parseCompareAtPrice('55', 50)).toBe(55);
  expect(parseCompareAtPrice('', 50)).toBeNull();
  for (const value of [50, 49, 'NaN', Infinity, {}, true]) {
    expect(() => parseCompareAtPrice(value, 50)).toThrow();
  }
});

test('catalogue position permits explicit priority and rejects malformed values', () => {
  expect(parseCatalogPosition('-1')).toBe(-1);
  expect(parseCatalogPosition(undefined)).toBe(9999);
  for (const value of ['1.5', 'abc', Infinity, {}, true]) expect(() => parseCatalogPosition(value)).toThrow();
});

test('priority preserves pagination without duplicating a product ranked later', () => {
  const ranked = ['a', 'b', 'c', 'pin', 'd', 'e'];
  expect(prioritizedCatalogIds(ranked, ['pin'], 0, 3)).toEqual(['pin', 'a', 'b']);
  expect(prioritizedCatalogIds(ranked, ['pin'], 3, 3)).toEqual(['c', 'd', 'e']);
  expect(prioritizedCatalogIds(ranked, ['pin'], 6, 3)).toEqual([]);
});
