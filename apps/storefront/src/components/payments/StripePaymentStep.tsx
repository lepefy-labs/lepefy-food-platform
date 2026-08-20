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
  // Légende affichée au-dessus du Payment Element. Stripe peut demander un
  // champ "Pays" (mode 'auto') sans préciser s'il s'agit du pays de
  // facturation de la carte ou de la position du client — ambigu pour un
  // touriste ou un expatrié. L'étiquette native est dans l'iframe Stripe
  // (PCI), donc non modifiable : on lève l'ambiguïté juste à côté.
  // Fournie par l'appelant, comme payLabel/processingLabel, pour rester dans
  // son propre schéma de traduction — jamais codée en dur ici.
  billingCountryHint: string;
  createIntent:  () => Promise<CreateIntentResult>;   // logique de domaine spécifique au module — validation métier + création du PaymentIntent côté serveur
  onError:       (msg: string) => void;
  onSucceeded:   (paymentIntentId?: string) => void;
  // Agente e2e Fase 0 — calculé côté serveur (isE2ERequest()) par la page
  // appelante et transmis en prop jusqu'ici : bascule la publishable key
  // vers le compte Stripe séparé dédié aux tests e2e. Absent (donc false)
  // pour tous les appelants non encore migrés (card, rental).
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

  useEffect(() => {
    logFunnelEvent({ module, event_type: 'elements_mounted', reference_id: referenceIdRef.current });
    return registerAbandonmentListener({ module, reference_id: referenceIdRef.current, hasSucceededRef });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setIsConfirming(true);

    // Filet de sécurité : Stripe.js *lève* certaines erreurs (IntegrationError
    // notamment) au lieu de les retourner dans { error }. Sans ce try/catch,
    // une exception ressortait de handleConfirm sans jamais atteindre un
    // setIsConfirming(false) — le bouton restait figé sur "Traitement en
    // cours…" définitivement et sans message. Vaut pour toute exception
    // future, pas seulement celle déjà diagnostiquée.
    try {
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
        // requièrent — aucune action supplémentaire côté client, et le bouton
        // reste volontairement désactivé pour éviter un double envoi.
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
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
        <p className="text-sm font-semibold text-gray-700 mb-1">Paiement sécurisé</p>
        {/* Placée entre le titre et le Payment Element : le texte parle des
            champs « ci-dessous », il doit donc les précéder immédiatement, et
            rester dans la même carte blanche pour se lire comme une note du
            bloc de paiement. Toujours visible — impossible de détecter de
            façon fiable si Stripe affiche réellement le champ Pays, et la
            note reste inoffensive quand il est absent. */}
        <p className="text-xs text-gray-500 leading-relaxed mb-4">{billingCountryHint}</p>
        <PaymentElement
          options={{
            layout: 'accordion',
            // NE PAS réintroduire `fields: { billingDetails: { address: 'never' } }`.
            // Opter pour 'never' oblige à fournir soi-même les champs omis
            // (au minimum address.country) dans confirmParams lors de
            // confirmPayment ; sans cela Stripe *lève* une IntegrationError
            // (et non un { error } retourné), ce qui a figé le bouton de
            // paiement sur les 5 flux. Le défaut 'auto' laisse Stripe décider
            // au cas par cas des champs réellement nécessaires — aucun
            // plumbing de données requis de notre côté.
            //
            // Pas de defaultValues.billingDetails.email non plus : préremplir
            // une email connue déclenche le processus d'authentification Link,
            // à l'origine des blocages "trop de tentatives de connexion".
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
        // Pas de paymentMethodTypes ici : les méthodes proposées suivent les
        // réglages du Dashboard, en cohérence avec automatic_payment_methods
        // côté serveur (voir les 5 endpoints de création de PaymentIntent).
        //
        // RAPPEL — Link doit être désactivé manuellement depuis Stripe
        // Dashboard (Settings → Payment Methods → Link) pour supprimer
        // l'écran Accelerated Sign-up : action en attente côté compte, non
        // pilotable depuis ce code.
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
