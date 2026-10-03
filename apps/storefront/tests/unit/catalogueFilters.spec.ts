import { test, expect } from '@playwright/test';
import {
  applyCatalogueStatus, catalogueQueryString, completenessIssues, parseCatalogueState, stockTone,
} from '../../src/lib/catalog/catalogueFilters';

function recorder() {
  const ops: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['eq', 'gte', 'lte', 'or', 'is']) builder[method] = (...args: unknown[]) => { ops.push([method, args]); return builder; };
  return { builder, ops };
}

test('status filters map to the right product conditions', () => {
  const cases: Array<[Parameters<typeof applyCatalogueStatus>[1], Array<[string, unknown[]]>]> = [
    ['active', [['eq', ['active', true]]]],
    ['out', [['lte', ['stock', 0]]]],
    ['low', [['gte', ['stock', 1]], ['lte', ['stock', 9]]]],
    ['no_weight', [['or', ['weight_grams.is.null,weight_grams.lte.0']]]],
    ['no_image', [['is', ['image_url', null]]]],
    ['no_category', [['is', ['category_id', null]]]],
    ['all', []],
  ];
  for (const [status, expected] of cases) {
    const { builder, ops } = recorder();
    applyCatalogueStatus(builder, status);
    expect(ops).toEqual(expected);
  }
});

test('list state round-trips through the URL, defaults omitted, junk rejected', () => {
  const params = (query: string) => new URLSearchParams(query);
  expect(catalogueQueryString(parseCatalogueState(params('')))).toBe('');
  const state = parseCatalogueState(params('q=garri&status=no_weight&category=farines&sort=stock_asc&page=3'));
  expect(state).toEqual({ q: 'garri', status: 'no_weight', category: 'farines', sort: 'stock_asc', page: 3 });
  expect(parseCatalogueState(params(catalogueQueryString(state)))).toEqual(state);
  expect(parseCatalogueState(params('status=drop&sort=evil&page=-1'))).toMatchObject({ status: 'all', sort: 'position_asc', page: 1 });
});

test('stock tone and completeness badges only flag real gaps', () => {
  expect([0, 1, 9, 10].map(stockTone)).toEqual(['out', 'low', 'low', 'ok']);
  expect(completenessIssues({ weight_grams: 500, image_url: 'x.jpg', category_id: 'c' })).toEqual([]);
  expect(completenessIssues({ weight_grams: 0, image_url: null, category_id: null })).toEqual(['Sans poids', 'Sans photo', 'Sans catégorie']);
});
