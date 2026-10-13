import type { TenantPaymentMethod } from '@lepefy/types';

/**
 * Fascia « Moyens de paiement acceptés » de /card, dérivée uniquement des
 * méthodes réellement visibles (déjà filtrées par `visibleCardPaymentMethods` :
 * Apple Pay seulement si activé ET supporté par l'appareil). Pur, testé dans
 * tests/unit/cardPaymentBrands.spec.ts.
 *
 * - Visa et Mastercard sont les réseaux acceptés par la ligne `card`, pas
 *   deux parcours distincts.
 * - Stripe est le prestataire technique : il n'apparaît jamais comme marque
 *   sélectionnable, seulement dans la mention « sécurisé par Stripe »
 *   (`processedByStripe`).
 * - Google Pay n'est jamais affiché : depuis la landing on ne peut pas savoir
 *   si le Payment Element le proposera (Dashboard Stripe + appareil).
 */
export type CardPaymentBrand = 'visa' | 'mastercard' | 'apple_pay' | 'paypal' | 'satispay' | 'revolut';

export type CardPaymentChip = 'bank_transfer' | 'cash';

export interface CardPaymentBrandStrip {
  brands: CardPaymentBrand[];
  chips: CardPaymentChip[];
  processedByStripe: boolean;
}

export function isRevolutMethod(method: Pick<TenantPaymentMethod, 'method' | 'label'>): boolean {
  return method.method === 'other' && /revolut/i.test(method.label ?? '');
}

/** Méthodes réglées dans le flux Stripe de /card (confirmation immédiate). */
export function isOnlineCardMethod(method: Pick<TenantPaymentMethod, 'method'>): boolean {
  return method.method === 'card' || method.method === 'apple_pay';
}

export function cardPaymentBrandStrip(methods: ReadonlyArray<Pick<TenantPaymentMethod, 'method' | 'label'>>): CardPaymentBrandStrip {
  const brands = new Set<CardPaymentBrand>();
  const chips = new Set<CardPaymentChip>();
  for (const method of methods) {
    switch (method.method) {
      case 'card': brands.add('visa'); brands.add('mastercard'); break;
      case 'apple_pay': brands.add('apple_pay'); break;
      case 'paypal': brands.add('paypal'); break;
      case 'satispay': brands.add('satispay'); break;
      case 'bank_transfer': chips.add('bank_transfer'); break;
      case 'cash': chips.add('cash'); break;
      case 'other': if (isRevolutMethod(method)) brands.add('revolut'); break;
    }
  }
  const order: CardPaymentBrand[] = ['visa', 'mastercard', 'apple_pay', 'paypal', 'satispay', 'revolut'];
  return {
    brands: order.filter((brand) => brands.has(brand)),
    chips: (['bank_transfer', 'cash'] as const).filter((chip) => chips.has(chip)),
    processedByStripe: methods.some(isOnlineCardMethod),
  };
}
