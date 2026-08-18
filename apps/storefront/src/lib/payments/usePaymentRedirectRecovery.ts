'use client';

import { useEffect } from 'react';
import { getStripeForModule, type PaymentModule } from './stripeClientConfig';

// Au montage de chaque module, vérifie si l'URL contient les paramètres que
// Stripe ajoute après une redirection complète d'authentification (3DS ou
// méthodes redirect-based) — cela se produit indépendamment du fait que
// l'intent soit créé de façon différée ou non, car ça arrive APRÈS la
// création. Si le paiement est 'succeeded', rappelle onSucceeded sans que le
// client n'ait rien à refaire.
export function usePaymentRedirectRecovery(module: PaymentModule, onSucceeded: (paymentIntentId?: string) => void) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const secretFromUrl = params.get('payment_intent_client_secret');
    if (!secretFromUrl) return;

    getStripeForModule(module).then((stripeInstance) => {
      if (!stripeInstance) return;
      stripeInstance.retrievePaymentIntent(secretFromUrl).then(({ paymentIntent }) => {
        if (paymentIntent?.status === 'succeeded') {
          onSucceeded(paymentIntent.id);
        }
        window.history.replaceState({}, '', window.location.pathname);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
