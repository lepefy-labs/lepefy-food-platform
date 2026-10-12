/**
 * Lien de paiement externe (PayPal.me, Satispay, Revolut…) d'un moyen de
 * paiement du tenant. Règle unique pour tous les checkouts (boutique, session
 * assistée, événements, location, supplément de livraison) et pour les écrans
 * qui choisissent le message au client. Fonctions pures, imports relatifs uniquement.
 *
 * Seul un lien PayPal.me (paypal.me/<nom> ou paypal.com/paypalme/<nom>) reçoit
 * le montant dans l'URL ; les autres liens restent tels quels et le montant
 * doit être communiqué au client à côté du lien.
 */

export interface LinkPaymentMethodLike {
  method: string;
  extra?: { link?: string | null } | null;
}

const AMOUNT_SEGMENT = /^\d+(?:[.,]\d+)?[A-Za-z]{3}$/;

/** Moyen de paiement utilisable par lien (ni virement, ni espèces, lien renseigné). */
export function isLinkPaymentMethod(method: LinkPaymentMethodLike | null | undefined): boolean {
  return Boolean(method && method.method !== 'bank_transfer' && method.method !== 'cash' && method.extra?.link?.trim());
}

interface PaypalMeLink {
  /** Lien sans requête ni ancre, sans « / » final ni montant déjà présent. */
  base: string;
  /** « ?… » et « #… » d'origine, conservés après le montant. */
  suffix: string;
}

function parsePaypalMeLink(raw: string): PaypalMeLink | null {
  const link = raw.trim();
  if (!link) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(link) ? link : `https://${link}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean);
  // Nombre de segments du lien de base : paypal.me/<nom> ou paypal.com/paypalme/<nom>.
  let nameSegments: number;
  if (host === 'paypal.me') nameSegments = 1;
  else if (host === 'paypal.com' && segments[0]?.toLowerCase() === 'paypalme') nameSegments = 2;
  else return null;
  if (segments.length < nameSegments) return null;

  // Travail sur la chaîne d'origine pour la rendre caractère pour caractère.
  const cut = link.search(/[?#]/);
  let base = (cut === -1 ? link : link.slice(0, cut)).replace(/\/+$/, '');
  const suffix = cut === -1 ? '' : link.slice(cut);
  if (segments.length > nameSegments && AMOUNT_SEGMENT.test(segments[segments.length - 1] ?? '')) {
    base = base.replace(/\/[^/]+$/, '');
  }
  return { base, suffix };
}

/** Le lien de ce moyen de paiement contient-il le montant à payer ? */
export function linkIncludesAmount(method: LinkPaymentMethodLike): boolean {
  return method.method === 'paypal' && parsePaypalMeLink(method.extra?.link ?? '') !== null;
}

/** Lien configuré `link` complété du montant quand c'est un lien PayPal.me, sinon inchangé (sans espaces autour). */
export function applyLinkAmount(methodName: string, link: string, amount: number, currency: string): string {
  const trimmed = link.trim();
  const paypal = methodName === 'paypal' ? parsePaypalMeLink(trimmed) : null;
  if (!paypal) return trimmed;
  return `${paypal.base}/${amount.toFixed(2)}${currency.toUpperCase()}${paypal.suffix}`;
}

/** Lien à envoyer au client pour `amount`, ou null si le moyen n'est pas un moyen par lien. */
export function buildExternalPaymentLink(method: LinkPaymentMethodLike, amount: number, currency: string): string | null {
  if (!isLinkPaymentMethod(method)) return null;
  return applyLinkAmount(method.method, method.extra?.link ?? '', amount, currency);
}
