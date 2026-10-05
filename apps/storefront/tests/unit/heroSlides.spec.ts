import { expect, test } from '@playwright/test';
import { moveId, reorderPositions, safeSlideHref, slideIssues } from '../../src/lib/home/heroSlideRules';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

const valid = { title: 'Nouveautés', cta_primary_label: 'Voir', cta_primary_url: '/products', cta_secondary_label: '', cta_secondary_url: '' };

test('only internal paths and https links are accepted', () => {
  expect(safeSlideHref('/products')).toBe('/products');
  expect(safeSlideHref(' /evenements?x=1 ')).toBe('/evenements?x=1');
  expect(safeSlideHref('https://events.chloefood.com/')).toBe('https://events.chloefood.com/');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil.example',
    'http://chloefood.com', 'https://user:pw@evil.example', 'products', '', null]) {
    expect(safeSlideHref(bad), String(bad)).toBeNull();
  }
});

test('slide issues', () => {
  expect(slideIssues(valid)).toEqual([]);
  expect(slideIssues({ ...valid, title: ' ' })).toHaveLength(1);
  expect(slideIssues({ ...valid, cta_primary_url: '' })).toHaveLength(1);
  expect(slideIssues({ ...valid, cta_primary_url: 'javascript:alert(1)' })).toHaveLength(1);
  expect(slideIssues({ ...valid, cta_secondary_label: 'Événements' })).toHaveLength(1);
  expect(slideIssues({ ...valid, cta_primary_label: '', cta_primary_url: '' })).toEqual([]);
  expect(slideIssues({ ...valid, title: 'x'.repeat(121) })).toHaveLength(1);
});

test('reorder', () => {
  expect(moveId(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
  expect(moveId(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  expect(reorderPositions(['a', 'b'], ['b', 'a'])).toEqual([{ id: 'b', position: 0 }, { id: 'a', position: 1 }]);
  expect(reorderPositions(['a', 'b'], ['a'])).toBeNull();
  expect(reorderPositions(['a', 'b'], ['a', 'a'])).toBeNull();
  expect(reorderPositions(['a', 'b'], ['a', 'x'])).toBeNull();
});

test('slide image upload carries the catalogue permission', () => {
  expect(permissionForAdminApi('/api/admin/hero-slides/upload-image', 'POST')).toBe('catalog.manage');
  expect(permissionForAdminApi('/api/admin/hero-slides/order', 'PUT')).toBe('catalog.manage');
  expect(permissionForAdminApi('/api/admin/evenementiel/upload-image', 'POST')).toBe('event_content.manage');
});
