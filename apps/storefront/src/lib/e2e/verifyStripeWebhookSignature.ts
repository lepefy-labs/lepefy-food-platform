import type Stripe from 'stripe';

// NOTE (déviation Task 3b) — la route webhook existante vérifie déjà la
// signature contre PLUSIEURS secrets (un par module : shop/card/event/rental,
// dédupliqués — voir stripeServerConfig.ts::getConfiguredWebhookSecrets()).
// Ce fichier ajoute simplement un essai supplémentaire, après cette boucle
// existante, contre le secret de l'account Stripe séparé dédié aux tests e2e
// (STRIPE_WEBHOOK_SECRET_TEST) — sans dupliquer ni modifier la boucle
// existante. stripe.webhooks.constructEvent ne dépend pas de la secret key
// de l'instance Stripe utilisée (calcul HMAC pur sur le payload), donc
// n'importe quel client Stripe déjà instancié fait l'affaire ici.

/**
 * Tente de vérifier la signature d'un evento webhook Stripe contro il
 * secret dell'account e2e separato (STRIPE_WEBHOOK_SECRET_TEST). Ritorna
 * l'evento se verificato, null altrimenti (secret non configurato o firma
 * non valida). Non logga MAI il secret.
 */
export function verifyE2EStripeWebhookSignature(
  stripe: Stripe,
  payload: string | Buffer,
  signature: string,
): Stripe.Event | null {
  const testSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST;
  if (!testSecret) return null;

  try {
    return stripe.webhooks.constructEvent(payload, signature, testSecret);
  } catch {
    return null;
  }
}
