'use client';

import { useEffect, useState } from 'react';
import { getStripeForModule } from '@/lib/payments/stripeClientConfig';
import { outcomeFromIntentStatus, recallCardPayment, type CardPaymentOutcome, type CardPaymentReceipt } from './cardPaymentOutcome';

/**
 * Return to /card after a redirect (bank authentication, redirect-based
 * method): Stripe appends payment_intent_client_secret to return_url. /card
 * then opens on its home, where CardQuickPay is not mounted, so the outcome is
 * read here. Read-only (publishable key); the webhook stays the source of
 * truth for tenant_card_payments.
 */
export function useCardPaymentReturn() {
  const [result, setResult] = useState<{ outcome: CardPaymentOutcome; receipt: CardPaymentReceipt } | null>(null);

  useEffect(() => {
    const secret = new URLSearchParams(window.location.search).get('payment_intent_client_secret');
    if (!secret) return;
    let active = true;
    getStripeForModule('card').then((stripe) => stripe?.retrievePaymentIntent(secret)).then((response) => {
      const intent = response?.paymentIntent;
      const outcome = outcomeFromIntentStatus(intent?.status);
      if (active && intent && outcome) {
        const remembered = recallCardPayment(intent.id);
        setResult({
          outcome,
          receipt: { amount: intent.amount / 100, reference: remembered?.reference ?? null, email: remembered?.email ?? null },
        });
      }
    }).catch((error) => {
      console.warn('[card] payment return could not be read:', error);
    }).finally(() => {
      // Never leave the secret in the address bar (shared screen, reload).
      window.history.replaceState({}, '', window.location.pathname);
    });
    return () => { active = false; };
  }, []);

  return { result, clear: () => setResult(null) };
}
