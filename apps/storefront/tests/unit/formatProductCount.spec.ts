import { test, expect } from '@playwright/test';
import { formatProductCount } from '@/lib/cart/formatProductCount';

test('singulier à 1', async () => {
  expect(formatProductCount(1)).toBe('1 article');
});

test('pluriel au-delà de 1', async () => {
  expect(formatProductCount(2)).toBe('2 articles');
  expect(formatProductCount(4)).toBe('4 articles');
  expect(formatProductCount(99)).toBe('99 articles');
});

test('0 reste au singulier grammatical ("0 article"), affichage conditionné par l\'appelant', async () => {
  // deriveCartItemState/CartDrawerHeader n'affiche ce texte que si count > 0 —
  // ce test documente juste le comportement de la fonction pure isolée.
  expect(formatProductCount(0)).toBe('0 article');
});
