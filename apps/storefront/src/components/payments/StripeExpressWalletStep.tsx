'use client';

import { useState, useRef, useEffect } from 'react';
import { Elements, ExpressCheckoutElement, useStripe, useElements } from '@stripe/react-stripe-js';
import type { StripeExpressCheckoutElementConfirmEvent } from '@stripe/stripe-js';
import { IconBrandApple, IconCreditCard } from '@tabler/icons-react';
import { getStripeForModule, type PaymentModule } from '@/lib/payments/stripeClientConfig';
import { logFunnelEvent, registerAbandonmentListener } from '@/lib/funnelLog';

// Flux « un seul bouton » Apple Pay (Express Checkout Element), utilisé
// aujourd'hui uniquement par /card (CardQuickPay mode="apple_pay"). Même
// séquence que StripePaymentStep : elements.submit() → createIntent()
// (validation serveur, route inchangée) → stripe.confirmPayment(), mêmes
// event_type de funnel (detail.wallet = 'apple_pay'). StripePaymentStep
// n'est volontairement pas refactorisé pour partager ce code : son flux
// reste strictement inchangé.

interface CreateIntentResult {
  clientSecret?: string;
  reference_id?: string | null;
  error?: string;
}

export interface ExpressWalletLabels {
  secureTitle: string;
  faceIdHint: string;
  notShowingHint: string;
  unavailableTitle: string;
  unavailableText: string;
  useCard: string;
  loading: string;
}

interface StripeExpressWalletStepProps {
  module:       PaymentModule;
  amount:       number;
  currency:     string;
  returnUrl:    string;
  locale?:      'auto' | 'fr' | 'it';
  labels:       ExpressWalletLabels;
  createIntent: () => Promise<CreateIntentResult>;
  onError:      (msg: string) => void;
  onSucceeded:  (paymentIntentId?: string) => void;
  onUseCard?:   () => void;
}

const GENERIC_ERROR = 'Erreur lors du paiement.';
const WALLET_DETAIL = { wallet: 'apple_pay' } as const;

type Availability = 'loading' | 'available' | 'unavailable';

function InnerExpressWalletStep({
  module, returnUrl, labels, createIntent, onError, onSucceeded, onUseCard,
}: Omit<StripeExpressWalletStepProps, 'amount' | 'currency' | 'locale'>) {
  const stripe   = useStripe();
  const elements = useElements();
  const [availability, setAvailability] = useState<Availability>('loading');
  const [isConfirming, setIsConfirming] = useState(false);
  const referenceIdRef  = useRef<string | null>(null);
  const hasSucceededRef = useRef(false);

  useEffect(() => {
    logFunnelEvent({ module, event_type: 'elements_mounted', reference_id: null, detail: WALLET_DETAIL });
    return registerAbandonmentListener({ module, reference_id: referenceIdRef.current, hasSucceededRef });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isConfirming) return;
    const preventAccidentalExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventAccidentalExit);
    return () => window.removeEventListener('beforeunload', preventAccidentalExit);
  }, [isConfirming]);

  async function handleConfirm(event: StripeExpressCheckoutElementConfirmEvent) {
    if (!stripe || !elements) {
      event.paymentFailed({ reason: 'fail' });
      return;
    }
    setIsConfirming(true);

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        event.paymentFailed({ reason: 'fail' });
        onError(submitError.message ?? GENERIC_ERROR);
        setIsConfirming(false);
        return;
      }

      logFunnelEvent({ module, event_type: 'confirm_attempted', reference_id: referenceIdRef.current, detail: WALLET_DETAIL });

      const result = await createIntent();
      if (result.error || !result.clientSecret) {
        // Échec avant confirmPayment : fermer la feuille Apple Pay tout de
        // suite plutôt que la laisser tourner jusqu'au timeout.
        event.paymentFailed({ reason: 'fail' });
        onError(result.error ?? GENERIC_ERROR);
        logFunnelEvent({ module, event_type: 'confirm_error', reference_id: referenceIdRef.current, detail: { stage: 'create_intent', message: result.error ?? null, ...WALLET_DETAIL } });
        setIsConfirming(false);
        return;
      }
      if (result.reference_id) referenceIdRef.current = result.reference_id;

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: result.clientSecret,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      });

      if (error) {
        onError(error.message ?? GENERIC_ERROR);
        logFunnelEvent({
          module, event_type: 'confirm_error', reference_id: referenceIdRef.current,
          detail: { code: error.code ?? null, type: error.type ?? null, ...WALLET_DETAIL },
        });
        setIsConfirming(false);
        return;
      }

      if (paymentIntent?.status === 'requires_action') {
        logFunnelEvent({ module, event_type: 'requires_action', reference_id: referenceIdRef.current, detail: WALLET_DETAIL });
        return;
      }

      hasSucceededRef.current = true;
      logFunnelEvent({ module, event_type: 'confirm_succeeded_client', reference_id: referenceIdRef.current, detail: WALLET_DETAIL });
      onSucceeded(paymentIntent?.id);
    } catch (err) {
      event.paymentFailed({ reason: 'fail' });
      onError(err instanceof Error ? err.message : GENERIC_ERROR);
      logFunnelEvent({
        module, event_type: 'confirm_error', reference_id: referenceIdRef.current,
        detail: { stage: 'unexpected', message: err instanceof Error ? err.message : String(err), ...WALLET_DETAIL },
      });
      setIsConfirming(false);
    }
  }

  if (availability === 'unavailable') {
    return (
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-black text-white">
          <IconBrandApple size={22} />
        </div>
        <p className="font-bold text-gray-900">{labels.unavailableTitle}</p>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">{labels.unavailableText}</p>
        {onUseCard && (
          <button
            type="button"
            onClick={onUseCard}
            className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-black px-4 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          >
            <IconCreditCard size={18} />
            {labels.useCard}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-gray-700">{labels.secureTitle}</p>
        {availability === 'loading' && (
          <div aria-live="polite" className="flex h-12 items-center justify-center rounded-xl bg-gray-100 text-xs text-gray-400">
            {labels.loading}
          </div>
        )}
        <div className={availability === 'available' ? '' : 'h-0 overflow-hidden'}>
          <ExpressCheckoutElement
            options={{
              // 'auto' (et non 'always') : sans carte dans le Wallet, Stripe
              // ne rend pas le bouton et onReady déclenche le repli carte.
              paymentMethods: { applePay: 'auto',googlePay: 'never', link: 'never', paypal: 'never', amazonPay: 'never' },
              buttonType: { applePay: 'plain' },
              buttonTheme: { applePay: 'black' },
              buttonHeight: 48,
            }}
            onReady={({ availablePaymentMethods }) => setAvailability(availablePaymentMethods?.applePay ? 'available' : 'unavailable')}
            onLoadError={() => setAvailability('unavailable')}
            onConfirm={handleConfirm}
          />
        </div>
        <p className="mt-3 text-center text-xs text-gray-500">{labels.faceIdHint}</p>
      </div>
      <p className="px-1 text-center text-xs leading-relaxed text-gray-400">{labels.notShowingHint}</p>
    </div>
  );
}

export function StripeExpressWalletStep(props: StripeExpressWalletStepProps) {
  return (
    <Elements
      stripe={getStripeForModule(props.module)}
      options={{
        mode: 'payment',
        amount: Math.round(props.amount * 100),
        currency: props.currency.toLowerCase(),
        locale: props.locale ?? 'fr',
        appearance: { theme: 'stripe', variables: { borderRadius: '12px' } },
      }}
    >
      <InnerExpressWalletStep {...props} />
    </Elements>
  );
}
