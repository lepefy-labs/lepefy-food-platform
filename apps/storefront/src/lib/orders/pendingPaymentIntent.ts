import { getStripeClient } from '@/lib/payments/stripeServerConfig';

export type PendingIntentRelease = 'none' | 'released' | 'blocked' | 'unverifiable';

/**
 * Avant toute action qui invalide le montant ou encaisse autrement une session
 * (modification, annulation, confirmation manuelle), le PaymentIntent Stripe
 * encore ouvert doit être annulé pour que le client ne puisse plus payer un
 * montant périmé ou payer deux fois.
 *
 * - `released` : intent annulé (ou déjà annulé) → l'action peut continuer ;
 * - `blocked` : paiement réussi / en cours de traitement → le webhook Stripe
 *   reste l'autorité, l'action admin doit être refusée ;
 * - `unverifiable` : Stripe injoignable → refuser par prudence (fail-closed).
 */
export async function releasePendingPaymentIntent(intentId: string | null | undefined): Promise<PendingIntentRelease> {
  if (!intentId) return 'none';
  const stripe = getStripeClient('shop');
  try {
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent.status === 'canceled') return 'released';
    if (intent.status === 'succeeded' || intent.status === 'processing' || intent.status === 'requires_capture') {
      return 'blocked';
    }
    await stripe.paymentIntents.cancel(intentId);
    return 'released';
  } catch (error) {
    console.warn('[pendingPaymentIntent] unable to verify/cancel intent:', intentId, error);
    return 'unverifiable';
  }
}

export const PAYMENT_IN_PROGRESS_MESSAGE =
  'Un paiement par carte est en cours ou déjà effectué pour cette précommande : attendez sa confirmation automatique.';
export const PAYMENT_UNVERIFIABLE_MESSAGE =
  'Impossible de vérifier le paiement par carte associé. Réessayez dans un instant.';
