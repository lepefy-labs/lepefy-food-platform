'use client';

import { useState, useRef, useEffect } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { getStripeForModule, type PaymentModule } from '@/lib/payments/stripeClientConfig';
import { logFunnelEvent, registerAbandonmentListener } from '@/lib/funnelLog';

interface CreateIntentResult {
  clientSecret?: string;
  reference_id?: string | null;
  error?: string;
}

interface StripePaymentStepProps {
  module:        PaymentModule;
  amount:        number;
  currency:      string;
  color:         string;
  returnUrl:     string;
  referenceId:   string | null;
  payLabel:      string;
  processingLabel: string;
  billingCountryHint: string;
  createIntent:  () => Promise<CreateIntentResult>;
  onError:       (msg: string) => void;
  onSucceeded:   (paymentIntentId?: string) => void;
  isTest?: boolean;
}

function InnerPaymentStep({
  module, color, returnUrl, payLabel, processingLabel, billingCountryHint,
  createIntent, onError, onSucceeded, referenceIdRef,
}: Omit<StripePaymentStepProps, 'referenceId' | 'amount' | 'currency'> & { referenceIdRef: React.MutableRefObject<string | null> }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [isConfirming, setIsConfirming] = useState(false);
  const hasSucceededRef = useRef(false);
  const isEventPayment = module === 'event';

  useEffect(() => {
    logFunnelEvent({ module, event_type: 'elements_mounted', reference_id: referenceIdRef.current });
    return registerAbandonmentListener({ module, reference_id: referenceIdRef.current, hasSucceededRef });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setIsConfirming(true);

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        onError(submitError.message ?? 'Erreur lors du paiement.');
        setIsConfirming(false);
        return;
      }

      logFunnelEvent({ module, event_type: 'confirm_attempted', reference_id: referenceIdRef.current });

      const result = await createIntent();
      if (result.error || !result.clientSecret) {
        onError(result.error ?? 'Erreur lors du paiement.');
        logFunnelEvent({ module, event_type: 'confirm_error', reference_id: referenceIdRef.current, detail: { stage: 'create_intent', message: result.error ?? null } });
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
        onError(error.message ?? 'Erreur lors du paiement.');
        logFunnelEvent({
          module, event_type: 'confirm_error', reference_id: referenceIdRef.current,
          detail: { code: error.code ?? null, type: error.type ?? null },
        });
        setIsConfirming(false);
        return;
      }

      if (paymentIntent?.status === 'requires_action') {
        logFunnelEvent({ module, event_type: 'requires_action', reference_id: referenceIdRef.current });
        return;
      }

      hasSucceededRef.current = true;
      logFunnelEvent({ module, event_type: 'confirm_succeeded_client', reference_id: referenceIdRef.current });
      onSucceeded(paymentIntent?.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur lors du paiement.');
      logFunnelEvent({
        module, event_type: 'confirm_error', reference_id: referenceIdRef.current,
        detail: { stage: 'unexpected', message: err instanceof Error ? err.message : String(err) },
      });
      setIsConfirming(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="mb-1 text-sm font-semibold text-gray-700">Paiement sécurisé</p>
        <p className="mb-4 text-xs leading-relaxed text-gray-500">{billingCountryHint}</p>
        {isEventPayment && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900" role="note">
            N’interrompez pas le paiement : après l’initialisation, ne fermez pas et n’actualisez pas cette page jusqu’à la confirmation.
          </div>
        )}
        <PaymentElement options={{ layout: 'accordion' }} />
      </div>
      <button
        onClick={handleConfirm}
        disabled={isConfirming || !stripe || !elements}
        className="w-full rounded-2xl py-4 text-base font-bold text-white transition-opacity disabled:opacity-50"
        style={{ backgroundColor: color }}
      >
        {isConfirming ? processingLabel : payLabel}
      </button>
    </div>
  );
}

export function StripePaymentStep(props: StripePaymentStepProps) {
  const referenceIdRef = useRef<string | null>(props.referenceId);
  const isEventPayment = props.module === 'event';

  return (
    <Elements
      stripe={getStripeForModule(props.module, props.isTest)}
      options={{
        mode: 'payment',
        amount: Math.round(props.amount * 100),
        currency: props.currency.toLowerCase(),
        ...(isEventPayment ? { paymentMethodTypes: ['card'] } : {}),
        locale: isEventPayment ? 'fr' : 'auto',
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: props.color,
            borderRadius: '12px',
            fontFamily: 'inherit',
          },
        },
      }}
    >
      <InnerPaymentStep {...props} referenceIdRef={referenceIdRef} />
    </Elements>
  );
}
