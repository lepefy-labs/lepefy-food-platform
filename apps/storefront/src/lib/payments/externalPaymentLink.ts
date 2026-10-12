/**
 * Lien de paiement externe (PayPal.me, Satispay, Revolut…) d'un moyen de
 * paiement du tenant. Fonctions pures, imports relatifs uniquement.
 *
 * PayPal.me reçoit le montant dans l'URL ; les autres liens sont fixes et le
 * montant doit être communiqué au client à côté du lien.
 */

export interface LinkPaymentMethodLike {
  method: string;
  extra?: { link?: string | null } | null;
}

/** Moyen de paiement utilisable par lien (ni virement, ni espèces, lien renseigné). */
export function isLinkPaymentMethod(method: LinkPaymentMethodLike | null | undefined): boolean {
  return Boolean(method && method.method !== 'bank_transfer' && method.method !== 'cash' && method.extra?.link);
}

/** Le lien contient-il déjà le montant à payer ? */
export function linkIncludesAmount(method: LinkPaymentMethodLike): boolean {
  return method.method === 'paypal';
}

export function buildExternalPaymentLink(method: LinkPaymentMethodLike, amount: number, currency: string): string | null {
  if (!isLinkPaymentMethod(method)) return null;
  const link = method.extra?.link ?? '';
  return linkIncludesAmount(method)
    ? `${link.replace(/\/+$/, '')}/${amount.toFixed(2)}${currency.toUpperCase()}`
    : link;
}
