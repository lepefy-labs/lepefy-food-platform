import { expect, test } from '@playwright/test';
import {
  assembleCartSuggestions,
  isSuggestionPurchasable,
  parseCartProductIds,
} from '../../src/lib/cart/cartSuggestionRules';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const p = (n: number, stock = 50, min = 1, step = 1) => ({ id: id(n), stock, min_order_quantity: min, order_quantity_step: step });

test.describe('« Complétez votre panier »', () => {
  test('garde la priorité des sources : complémentaires, promotions, meilleures ventes', () => {
    const result = assembleCartSuggestions([[p(1)], [p(2), p(3)], [p(4), p(5)]], [], 4);
    expect(result.map((x) => x.id)).toEqual([id(1), id(2), id(3), id(4)]);
  });

  test('sans doublon entre sources et sans les produits du panier', () => {
    const result = assembleCartSuggestions([[p(1), p(2)], [p(2), p(3)], [p(1), p(4)]], [id(3)], 8);
    expect(result.map((x) => x.id)).toEqual([id(1), id(2), id(4)]);
  });

  test('écarte les produits non achetables (stock sous le minimum)', () => {
    expect(isSuggestionPurchasable(p(1, 0))).toBe(false);
    expect(isSuggestionPurchasable(p(1, 5, 6))).toBe(false);
    expect(isSuggestionPurchasable(p(1, 6, 6))).toBe(true);
    expect(isSuggestionPurchasable({ id: id(1), stock: null })).toBe(false);
    const result = assembleCartSuggestions([[p(1, 0), p(2, 3, 4), p(3, 8, 4, 2)]], [], 8);
    expect(result.map((x) => x.id)).toEqual([id(3)]);
  });

  test('sources vides : rien d’inventé', () => {
    expect(assembleCartSuggestions([[], [], []], [], 8)).toEqual([]);
  });

  test('ids du panier : UUID uniquement, sans doublon, au plus 30', () => {
    expect(parseCartProductIds(`${id(1)},x,${id(1)}, ${id(2)}`)).toEqual([id(1), id(2)]);
    expect(parseCartProductIds(null)).toEqual([]);
    expect(parseCartProductIds(Array.from({ length: 40 }, (_, i) => id(i)).join(','))).toHaveLength(30);
  });
});
