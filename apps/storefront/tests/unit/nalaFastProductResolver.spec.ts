import { test, expect } from '@playwright/test';
import {
  extractNalaAvailabilityProductQuery,
  resolveNalaFastProductAvailability,
} from '../../src/lib/ai/nalaFastProductResolver';

const products = [
  { id: '1', name: 'Ndolè frais (légumes The Chef)', name_alt: null, stock: 6 },
  { id: '2', name: 'Ndolè surgelé', name_alt: null, stock: 4 },
  { id: '3', name: 'Manioc frais', name_alt: 'Cassava', stock: 0 },
  { id: '4', name: 'Arachides dépulpées (Ndole)', name_alt: null, stock: 9 },
];

test('Product Fast Resolver extracts explicit availability questions in supported languages', () => {
  expect(extractNalaAvailabilityProductQuery('vous avez le ndolè?')).toBe('ndolè');
  expect(extractNalaAvailabilityProductQuery('Avez-vous du manioc en stock ?')).toBe('manioc');
  expect(extractNalaAvailabilityProductQuery('Avete il manioc?')).toBe('manioc');
  expect(extractNalaAvailabilityProductQuery('Do you have cassava?')).toBe('cassava');
});

test('Product Fast Resolver does not hijack recommendation, substitution or meal intents', () => {
  expect(extractNalaAvailabilityProductQuery('vous avez quelque chose pour remplacer le ndolè ?')).toBeNull();
  expect(extractNalaAvailabilityProductQuery('je veux préparer du ndolè ce soir')).toBeNull();
  expect(extractNalaAvailabilityProductQuery('que me conseillez-vous avec du poisson ?')).toBeNull();
});

test('Product Fast Resolver resolves one strong catalogue match without inference', () => {
  expect(resolveNalaFastProductAvailability({
    query: 'ndolè frais',
    locale: 'fr',
    products,
  })).toEqual({
    product: products[0],
    query: 'ndolè frais',
    available: true,
    reply: 'Oui, nous avons Ndolè frais (légumes The Chef) en stock.',
  });
});

test('Product Fast Resolver reports authoritative out-of-stock status', () => {
  expect(resolveNalaFastProductAvailability({
    query: 'manioc frais', locale: 'fr', products,
  }))?.toMatchObject({
    product: products[2],
    available: false,
    reply: 'Nous avons bien Manioc frais, mais il est actuellement en rupture de stock.',
  });
});

test('Product Fast Resolver refuses ambiguous strong matches', () => {
  expect(resolveNalaFastProductAvailability({
    query: 'ndolè', locale: 'fr', products,
  })).toBeNull();
});

test('Product Fast Resolver can use a curated alternate product name', () => {
  expect(resolveNalaFastProductAvailability({
    query: 'cassava', locale: 'en', products,
  }))?.toMatchObject({ product: products[2], available: false });
});
