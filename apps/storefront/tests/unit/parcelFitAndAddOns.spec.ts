import { test, expect } from '@playwright/test';
import { firstAddWeightG, fitsHeadroom, parcelFitLabel, selectParcelFits } from '../../src/lib/cart/parcelFit';
import { addOnWarnings, isMissingAddOnColumn, MAX_ADD_ONS, parseAddOnIds } from '../../src/lib/catalog/addOns';
import { assembleCartSuggestions } from '../../src/lib/cart/cartSuggestionRules';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const p = (n: number, weight: number | null, min = 1, stock = 50) => ({ id: id(n), weight_grams: weight, min_order_quantity: min, order_quantity_step: 1, stock });

test('parcel fit: the first add (minimum × weight) must fit the rounded margin; unknown weight never fits', () => {
  expect(firstAddWeightG(p(1, 500))).toBe(500);
  expect(firstAddWeightG(p(2, 250, 4))).toBe(1000);
  expect(firstAddWeightG(p(3, null))).toBeNull();
  expect(fitsHeadroom(p(1, 500), 500)).toBe(true);
  expect(fitsHeadroom(p(2, 250, 4), 900)).toBe(false);
  expect(fitsHeadroom(p(3, null), 5000)).toBe(false);
  expect(fitsHeadroom(p(1, 500), null)).toBe(false);
  expect(selectParcelFits([p(1, 6000), p(2, 300), p(3, null), p(4, 800), p(5, 100)], 1000, 2).map((x) => x.id)).toEqual([id(2), id(4)]);
  expect(parcelFitLabel(p(1, 500))).toBe('+500 g · livraison inchangée');
  expect(parcelFitLabel(p(2, 300, 4))).toBe('+1,2 kg · livraison inchangée');
});

test('cart suggestions keep priority: complementary, then petits plus, then promotions; cart and duplicates excluded', () => {
  const complementary = [p(1, 100), p(2, 100)];
  const addOns = [p(2, 100), p(3, 100), p(4, 100, 1, 0)];
  const promotions = [p(5, 100)];
  expect(assembleCartSuggestions([complementary, addOns, promotions], [id(1)], 8).map((x) => x.id)).toEqual([id(2), id(3), id(5)]);
});

test('add-on list: UUIDs only, order kept, duplicates removed, capped; warnings never block', () => {
  expect(parseAddOnIds([id(2), id(1), id(2)])).toEqual([id(2), id(1)]);
  expect(parseAddOnIds([id(1), 'not-a-uuid'])).toBeNull();
  expect(parseAddOnIds('x')).toBeNull();
  expect(parseAddOnIds(Array.from({ length: MAX_ADD_ONS + 1 }, (_, n) => id(n + 1)))).toBeNull();
  expect(addOnWarnings({ id: id(1), name: 'Chips', price: 2, stock: 0, active: false, weight_grams: null })).toEqual([
    'Inactif : jamais proposé', 'Sans poids : jamais dans « Ça rentre dans votre colis »',
  ]);
  expect(addOnWarnings({ id: id(2), name: 'Mambo', price: 1, stock: 3, active: true, weight_grams: 20, min_order_quantity: 5 })).toEqual([
    'Stock insuffisant : pas proposé pour l’instant',
  ]);
  expect(addOnWarnings({ id: id(3), name: 'Cube', price: 4, stock: 50, active: true, weight_grams: 100 })).toEqual([]);
  expect(isMissingAddOnColumn({ code: '42703', message: 'column products.add_on_position does not exist' })).toBe(true);
  expect(isMissingAddOnColumn({ code: '23505', message: 'duplicate' })).toBe(false);
  expect(isMissingAddOnColumn(null)).toBe(false);
});
