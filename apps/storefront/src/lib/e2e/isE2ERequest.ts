import { headers } from 'next/headers';
import { timingSafeEqual } from 'crypto';

// NOTE (déviation Task 2) — cette codebase résout déjà la Stripe secret key
// par module (voir stripeServerConfig.ts::getStripeSecretKey(module)), donc
// ce fichier n'exporte volontairement PAS de second getStripeSecretKey() :
// ça entrerait en collision de nom avec l'existant. L'awareness e2e est
// branchée directement dans stripeServerConfig.ts, qui appelle isE2ERequest()
// ci-dessous. Voir le deviation report pour le détail.

/**
 * Ritorna true SOLO se l'header x-e2e-test-token corrisponde esattamente
 * a E2E_TEST_SECRET. Usato per instradare i test automatici su Stripe test-mode
 * senza mai toccare le chiavi live usate dai clienti reali.
 * Se E2E_TEST_SECRET non è configurato in env, ritorna sempre false (fail-safe).
 *
 * Fase 0b — fix build production: next/headers() lancia se chiamato fuori da
 * uno scope di richiesta (es. import a livello di modulo, valutato da Next.js
 * durante "Collecting page data" in build). Diversi call site esistenti di
 * getStripeClient()/getStripeSecretKey() istanziano ancora a livello di
 * modulo (rental/checkout, card/quick-pay, checkout-sessions/*,
 * createOrderFromCheckoutSession.ts, createRentalReservationFromRequest.ts) —
 * spostarli tutti dentro gli handler avrebbe un raggio d'azione molto più
 * ampio di quanto sicuro qui. Il fix minimo e root-cause è rendere questa
 * funzione stessa sicura fuori da uno scope di richiesta: nessun token può
 * mai esistere in quel contesto, quindi false è la stessa risposta fail-safe
 * già prevista sopra, non un comportamento nuovo.
 */
export function isE2ERequest(): boolean {
  const secret = process.env.E2E_TEST_SECRET;
  if (!secret) return false;

  let token: string | null;
  try {
    token = headers().get('x-e2e-test-token');
  } catch {
    return false;
  }
  if (!token) return false;

  const secretBuf = Buffer.from(secret);
  const tokenBuf = Buffer.from(token);
  if (secretBuf.length !== tokenBuf.length) return false;

  return timingSafeEqual(secretBuf, tokenBuf);
}
