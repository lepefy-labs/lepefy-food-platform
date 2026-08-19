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
  amount:        number;   // total en unités de devise (pas en centimes) — sert uniquement de hint pour Elements et pour le bouton
  currency:      string;
  color:         string;
  returnUrl:     string;
  referenceId:   string | null;   // connu avant le clic Payer (ex. event.id) ; sinon null, mis à jour par createIntent
  payLabel:      string;   // ex. "Payer 12,00 €" — texte déjà formaté par l'appelant, prix inclus
  processingLabel: string;
  createIntent:  () => Promise<CreateIntentResult>;   // logique de domaine spécifique au module — validation métier + création du PaymentIntent côté serveur
  onError:       (msg: string) => void;
  onSucceeded:   (paymentIntentId?: string) => void;
  // Optionnel — préremplit l'email du Payment Element (accélère
  // l'authentification Link pour un client qui a déjà un compte) quand
  // l'appelant le connaît déjà avant cette étape. Aucun impact si absent.
  customerEmail?: string;
  // Agente e2e Fase 0 — calculé côté serveur (isE2ERequest()) par la page
  // appelante et transmis en prop jusqu'ici : bascule la publishable key
  // vers le compte Stripe séparé dédié aux tests e2e. Absent (donc false)
  // pour tous les appelants non encore migrés (card, rental).
  isTest?: boolean;
}

function InnerPaymentStep({
  module, color, returnUrl, payLabel, processingLabel,
  createIntent, onError, onSucceeded, referenceIdRef, customerEmail,
}: Omit<StripePaymentStepProps, 'referenceId' | 'amount' | 'currency'> & { referenceIdRef: React.MutableRefObject<string | null> }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [isConfirming, setIsConfirming] = useState(false);
  const hasSucceededRef = useRef(false);

  useEffect(() => {
    logFunnelEvent({ module, event_type: 'elements_mounted', reference_id: referenceIdRef.current });
    return registerAbandonmentListener({ module, reference_id: referenceIdRef.current, hasSucceededRef });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setIsConfirming(true);

    // Validation + collecte des données carte/wallet — étape requise par le
    // pattern "deferred intent creation" : elements.submit() valide le
    // PaymentElement AVANT que le PaymentIntent existe côté Stripe.
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
      // La redirection est déjà en cours à ce stade pour les méthodes qui la
      // requièrent — aucune action supplémentaire côté client.
      return;
    }

    hasSucceededRef.current = true;
    logFunnelEvent({ module, event_type: 'confirm_succeeded_client', reference_id: referenceIdRef.current });
    onSucceeded(paymentIntent?.id);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
        <p className="text-sm font-semibold text-gray-700 mb-4">Paiement sécurisé</p>
        <PaymentElement
          options={{
            layout: 'accordion',
            // Aucun confirmParams/createIntent de ce fichier ni des 4
            // appelants n'attend une adresse de facturation collectée par le
            // Payment Element (vérifié Step 0) — sûr de la désactiver partout.
            fields: { billingDetails: { address: 'never' } },
            defaultValues: customerEmail ? { billingDetails: { email: customerEmail } } : undefined,
          }}
        />
      </div>
      <button
        onClick={handleConfirm}
        disabled={isConfirming || !stripe || !elements}
        className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: color }}
      >
        {isConfirming ? processingLabel : payLabel}
      </button>
    </div>
  );
}

export function StripePaymentStep(props: StripePaymentStepProps) {
  const referenceIdRef = useRef<string | null>(props.referenceId);

  return (
    <Elements
      stripe={getStripeForModule(props.module, props.isTest)}
      options={{
        mode: 'payment',
        amount: Math.round(props.amount * 100),
        currency: props.currency.toLowerCase(),
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
