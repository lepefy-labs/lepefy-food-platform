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
// Agente e2e Fase 0 — isTest vient d'une prop calculée côté serveur
// (isE2ERequest(), via next/headers()) : ce fichier est 'use client', donc
// il ne peut jamais lire lui-même le header x-e2e-test-token. Le compte
// Stripe e2e est un compte séparé, pas "un module de plus" — une seule
// publishable key test, indépendante du module.
function resolvePublishableKey(module: PaymentModule, isTest?: boolean): string {
  if (isTest) {
    const testKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST;
    if (!testKey) throw new Error('E2E test mode richiesto ma NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST non configurata');
    return testKey;
  }

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
const promiseCache = new Map<string, Promise<StripeJs | null>>();

export function getStripeForModule(module: PaymentModule, isTest?: boolean): Promise<StripeJs | null> {
  const cacheKey = isTest ? `${module}:e2e` : module;
  const cached = promiseCache.get(cacheKey);
  if (cached) return cached;
  const promise = loadStripe(resolvePublishableKey(module, isTest));
  promiseCache.set(cacheKey, promise);
  return promise;
}
