import type { TenantPaymentMethod } from '@lepefy/types';

/**
 * Marques de paiement de /card (logos de `PaymentBrandMark`). Visa et
 * Mastercard sont les réseaux de la ligne `card`, pas deux parcours ; Stripe
 * n'est jamais une marque sélectionnable ; Google Pay n'est jamais affiché :
 * depuis la landing on ne peut pas savoir si le Payment Element le proposera
 * (Dashboard Stripe + appareil). Grille de la landing : `cardPaymentTiles.ts`.
 */
export type CardPaymentBrand = 'visa' | 'mastercard' | 'apple_pay' | 'paypal' | 'satispay' | 'revolut';

export function isRevolutMethod(method: Pick<TenantPaymentMethod, 'method' | 'label'>): boolean {
  return method.method === 'other' && /revolut/i.test(method.label ?? '');
}

/** Méthodes réglées dans le flux Stripe de /card (confirmation immédiate). */
export function isOnlineCardMethod(method: Pick<TenantPaymentMethod, 'method'>): boolean {
  return method.method === 'card' || method.method === 'apple_pay';
}
