'use client';

import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import type { PaymentModule } from '@lepefy/types';

// Fichier client-safe (publishable key uniquement) — jamais de secret key ni
// de webhook secret ici. Séparé volontairement de stripeServerConfig.ts pour
// éviter toute ambiguïté/erreur d'import.

export type { PaymentModule };

// IMPORTANT : chaque référence à process.env.NEXT_PUBLIC_* doit être écrite
// en toutes lettres, littéralement — Next.js ne remplace ces variables au
// build QUE dans ce cas. Construire le nom dynamiquement (ex.
// process.env[`NEXT_PUBLIC_X_${module}`]) donnerait toujours `undefined`
// dans le bundle client.
function resolvePublishableKey(module: PaymentModule): string {
  switch (module) {
    case 'card':
      return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_CARD || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!;
    case 'event':
      return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_EVENT || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!;
    case 'rental':
      return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_RENTAL || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!;
    case 'shop':
    default:
      return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_SHOP || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!;
  }
}

// Cache par module — pas un singleton global unique comme dans le pattern
// précédent, car deux modules peuvent désormais avoir des publishable key
// différentes.
const promiseCache = new Map<PaymentModule, Promise<StripeJs | null>>();

export function getStripeForModule(module: PaymentModule): Promise<StripeJs | null> {
  const cached = promiseCache.get(module);
  if (cached) return cached;
  const promise = loadStripe(resolvePublishableKey(module));
  promiseCache.set(module, promise);
  return promise;
}
