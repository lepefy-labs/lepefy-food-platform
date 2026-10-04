import { test, expect } from '@playwright/test';
import { changedFieldLabels, changedProductKeys, productPatchPayload, readFromParam } from '../../src/lib/catalog/productFormDiff';
import { catalogueQueryString, parseCatalogueState } from '../../src/lib/catalog/catalogueFilters';

const loaded = {
  name: 'Garri', stock: '20', price: '4.50', weight_grams: '', description_source: 'ai',
  descriptions: { fr: 'Texte', it: 'Testo' }, nutrition: { kcal: 350, fat_g: 1 }, images: [{ url: 'a.jpg' }],
};

test('nothing changed → empty payload (no PATCH, no embedding refresh)', () => {
  expect(productPatchPayload(loaded, { ...loaded, descriptions: { it: 'Testo', fr: 'Texte' }, nutrition: { fat_g: 1, kcal: 350 } })).toEqual({});
});

test('an untouched stock is never sent, so sales made meanwhile are kept', () => {
  const edited = { ...loaded, weight_grams: '450' };
  expect(productPatchPayload(loaded, edited)).toEqual({ weight_grams: '450' });
  expect(changedProductKeys(loaded, edited)).not.toContain('stock');
});

test('marking an AI description as reviewed only sends the source', () => {
  expect(productPatchPayload(loaded, { ...loaded, description_source: 'human' })).toEqual({ description_source: 'human' });
});

test('changed field labels are readable and de-duplicated', () => {
  const keys = changedProductKeys(loaded, { ...loaded, weight_grams: '450', descriptions: { fr: 'Nouveau', it: 'Testo' }, images: [{ url: 'b.jpg' }] });
  expect(changedFieldLabels(keys)).toEqual(['Poids', 'Descriptions', 'Images']);
  expect(changedFieldLabels(['unknown_column'])).toEqual(['unknown_column']);
});

test('the editor back link only keeps known catalogue list params', () => {
  const state = parseCatalogueState(readFromParam('status=no_weight&page=2&evil=<script>&sort=drop'));
  expect(catalogueQueryString(state)).toBe('status=no_weight&page=2');
  expect(catalogueQueryString(parseCatalogueState(readFromParam(undefined)))).toBe('');
});
