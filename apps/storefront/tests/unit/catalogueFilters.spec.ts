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
  const state = parseCatalogueState(params('q=garri&status=out&highlight=promo&issue=no_weight&category=farines&sort=stock_asc&page=3'));
  expect(state).toEqual({ q: 'garri', status: 'out', highlight: 'promo', issue: 'no_weight', category: 'farines', sort: 'stock_asc', page: 3, reception: '' });
  expect(parseCatalogueState(params(catalogueQueryString(state)))).toEqual(state);
  expect(parseCatalogueState(params('status=drop&highlight=out&issue=promo&sort=evil&page=-1'))).toMatchObject({ status: 'all', highlight: '', issue: '', sort: 'position_asc', page: 1 });
});

test('stock tone and completeness badges only flag real gaps', () => {
  expect([0, 1, 9, 10].map(stockTone)).toEqual(['out', 'low', 'low', 'ok']);
  expect(completenessIssues({ weight_grams: 500, image_url: 'x.jpg', category_id: 'c' })).toEqual([]);
  expect(completenessIssues({ weight_grams: 0, image_url: null, category_id: null })).toEqual(['Sans poids', 'Sans photo', 'Sans catégorie']);
});

test('reception filter: known fulfillment policies only, round-trips through the URL', () => {
  const params = (query: string) => new URLSearchParams(query);
  const state = parseCatalogueState(params('reception=pickup_only&status=active'));
  expect(state.reception).toBe('pickup_only');
  expect(catalogueQueryString(state)).toBe('status=active&reception=pickup_only');
  expect(parseCatalogueState(params(catalogueQueryString(state)))).toEqual(state);
  expect(parseCatalogueState(params('reception=teleport')).reception).toBe('');
});

test('legacy ?status= links for highlights and issues land on their own dimension', () => {
  const params = (query: string) => new URLSearchParams(query);
  expect(parseCatalogueState(params('status=no_weight'))).toMatchObject({ status: 'all', highlight: '', issue: 'no_weight' });
  expect(parseCatalogueState(params('status=novelty'))).toMatchObject({ status: 'all', highlight: 'novelty', issue: '' });
  expect(catalogueQueryString(parseCatalogueState(params('status=promo_scheduled')))).toBe('highlight=promo_scheduled');
  // An explicit param wins over the legacy one.
  expect(parseCatalogueState(params('status=no_image&issue=no_category')).issue).toBe('no_category');
});
