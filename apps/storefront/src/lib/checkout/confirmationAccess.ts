/**
 * Accès de la page de confirmation à la commande d'un client non connecté.
 *
 * Au moment du paiement carte, le checkout garde dans le sessionStorage de
 * l'onglet l'id de la session et son jeton d'accès, sous la clé du
 * PaymentIntent. La page /order-confirmation?payment_intent=… les relit et
 * interroge POST /api/checkout-sessions/[id]/order. Jamais dans l'URL : le
 * jeton ne finit ni dans l'historique ni dans les journaux. Une redirection
 * bancaire (3-D Secure plein écran, Bancontact…) revient dans le même onglet,
 * donc retrouve l'accès. Stockage indisponible (navigation privée stricte) :
 * la page garde son message générique.
 */

const KEY_PREFIX = 'lepefy-order-confirmation:';

export interface ConfirmationAccess {
  sessionId: string;
  accessToken: string;
}

/** `pi_123_secret_abc` → `pi_123` (null si le secret n'a pas cette forme). */
export function paymentIntentIdFromClientSecret(clientSecret: string | null | undefined): string | null {
  if (!clientSecret) return null;
  const index = clientSecret.indexOf('_secret_');
  const id = index > 0 ? clientSecret.slice(0, index) : '';
  return /^pi_[A-Za-z0-9]+$/.test(id) ? id : null;
}

export function rememberConfirmationAccess(clientSecret: string | null | undefined, access: Partial<ConfirmationAccess>): void {
  const paymentIntentId = paymentIntentIdFromClientSecret(clientSecret);
  if (!paymentIntentId || !access.sessionId || !access.accessToken) return;
  try {
    window.sessionStorage.setItem(KEY_PREFIX + paymentIntentId, JSON.stringify({ sessionId: access.sessionId, accessToken: access.accessToken }));
  } catch {
    // Stockage refusé : la confirmation retombe sur le message générique.
  }
}

export function readConfirmationAccess(paymentIntentId: string | null | undefined): ConfirmationAccess | null {
  if (!paymentIntentId) return null;
  try {
    const raw = window.sessionStorage.getItem(KEY_PREFIX + paymentIntentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConfirmationAccess>;
    return typeof parsed.sessionId === 'string' && typeof parsed.accessToken === 'string'
      ? { sessionId: parsed.sessionId, accessToken: parsed.accessToken }
      : null;
  } catch {
    return null;
  }
}
