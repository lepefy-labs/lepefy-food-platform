import { expect, test } from '@playwright/test';
import { calculateCartTotal, canProceedToCheckout } from '@/lib/cart/cartPagePresentation';

test('le total additionne la livraison au sous-total', () => {
  expect(calculateCartTotal(42.5, 7.5)).toBe(50);
});

test('un coût de livraison inconnu ne modifie pas le sous-total affiché', () => {
  expect(calculateCartTotal(42.5, null)).toBe(42.5);
});

test('la livraison exige un devis avant le checkout', () => {
  expect(canProceedToCheckout(2, 'delivery', null)).toBe(false);
  expect(canProceedToCheckout(2, 'delivery', 0)).toBe(true);
});

test('le retrait peut continuer sans devis mais jamais avec un panier vide', () => {
  expect(canProceedToCheckout(2, 'pickup', null)).toBe(true);
  expect(canProceedToCheckout(0, 'pickup', null)).toBe(false);
});
