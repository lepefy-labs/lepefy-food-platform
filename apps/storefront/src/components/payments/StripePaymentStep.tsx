'use client';

import { useState, useRef, useEffect } from 'react';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { getStripeForModule, type PaymentModule } from '@/lib/payments/stripeClientConfig';
import { logFunnelEvent, registerAbandonmentListener } from '@/lib/funnelLog';
import { useBusyLock } from '@/lib/pwa/useBusyLock';

interface CreateIntentResult {
  clientSecret?: string;
  reference_id?: string | null;
  error?: string;
}

type StripePaymentLocale = 'auto' | 'fr' | 'it';

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
  paymentWarning?: string;
  locale?: StripePaymentLocale;
  createIntent:  () => Promise<CreateIntentResult>;
  onError:       (msg: string) => void;
  onSucceeded:   (paymentIntentId?: string) => void;
  isTest?: boolean;
}

/**
 * Le message d'erreur est rendu par le module (checkout, /card, évènements…)
 * au-dessus du formulaire, souvent hors de l'écran sur mobile après un échec
 * 3-D Secure. On amène dans la vue la dernière alerte (`role="alert"`) qui
 * précède le formulaire, sinon la première qui le suit.
 */
function revealPaymentError(section: HTMLElement | null) {
  if (!section) return;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const alerts = Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]'))
      .filter((alert) => alert.offsetParent !== null && (alert.textContent ?? '').trim().length > 0);
    const before = alerts.filter((alert) => Boolean(alert.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING));
    const target = before[before.length - 1] ?? alerts.find((alert) => !section.contains(alert));
    if (!target) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }));
}

const DEFAULT_PAYMENT_WARNING = 'N’interrompez pas le paiement : après l’initialisation, ne fermez pas et n’actualisez pas cette page jusqu’à la confirmation.';

function InnerPaymentStep({
  module, color, returnUrl, payLabel, processingLabel, billingCountryHint, paymentWarning,
  createIntent, onError, onSucceeded, referenceIdRef,
}: Omit<StripePaymentStepProps, 'referenceId' | 'amount' | 'currency' | 'locale'> & { referenceIdRef: React.MutableRefObject<string | null> }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [isConfirming, setIsConfirming] = useState(false);
  // The payment form is open: no automatic reload while it exists (lib/pwa).
  useBusyLock(true, 'payment-form');
  const hasSucceededRef = useRef(false);
  const paymentSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logFunnelEvent({ module, event_type: 'elements_mounted', reference_id: referenceIdRef.current });
    return registerAbandonmentListener({ module, referenceIdRef, hasSucceededRef });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!paymentSectionRef.current) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = window.requestAnimationFrame(() => {
      paymentSectionRef.current?.scrollIntoView({
        block: 'center',
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    });

    return () => window.cancelAnimationFrame(frame);
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

  function reportError(message: string) {
    onError(message);
    revealPaymentError(paymentSectionRef.current);
  }

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setIsConfirming(true);

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        reportError(submitError.message ?? 'Erreur lors du paiement.');
        setIsConfirming(false);
        return;
      }

      const result = await createIntent();
      if (result.error || !result.clientSecret) {
        reportError(result.error ?? 'Erreur lors du paiement.');
        logFunnelEvent({ module, event_type: 'confirm_error', reference_id: referenceIdRef.current, detail: { stage: 'create_intent', message: result.error ?? null } });
        setIsConfirming(false);
        return;
      }
      if (result.reference_id) referenceIdRef.current = result.reference_id;
      // « Payer » cliqué, rattaché à la session créée (paiement différé : elle n'existe qu'ici).
      logFunnelEvent({ module, event_type: 'confirm_attempted', reference_id: referenceIdRef.current });

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: result.clientSecret,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      });

      if (error) {
        reportError(error.message ?? 'Erreur lors du paiement.');
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
      reportError(err instanceof Error ? err.message : 'Erreur lors du paiement.');
      logFunnelEvent({
        module, event_type: 'confirm_error', reference_id: referenceIdRef.current,
        detail: { stage: 'unexpected', message: err instanceof Error ? err.message : String(err) },
      });
      setIsConfirming(false);
    }
  }

  const payButton = (
    <button
      onClick={handleConfirm}
      disabled={isConfirming || !stripe || !elements}
      className="min-h-12 w-full rounded-2xl px-5 py-3.5 text-base font-bold text-white transition-opacity disabled:opacity-50"
      style={{ backgroundColor: color }}
    >
      {isConfirming ? processingLabel : payLabel}
    </button>
  );

  return (
    <div ref={paymentSectionRef} className="space-y-4 pb-[92px] lg:pb-0">
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="mb-1 text-sm font-semibold text-gray-700">Paiement sécurisé</p>
        <p className="mb-4 text-xs leading-relaxed text-gray-500">{billingCountryHint}</p>
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900" role="note">
          {paymentWarning ?? DEFAULT_PAYMENT_WARNING}
        </div>
        {/* Apple Pay jamais dans le Payment Element (tous modules) : il n'est
            proposé que via la tuile dédiée de /card (StripeExpressWalletStep).
            L'enregistrement du domaine Stripe vaut pour tout le domaine, pas
            par module. Google Pay inchangé. */}
        <PaymentElement options={{ layout: 'accordion', wallets: { applePay: 'never' } }} />
      </div>

      <div className="hidden lg:block">{payButton}</div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_rgba(0,0,0,.08)] backdrop-blur lg:hidden">
        <div className="mx-auto max-w-xl">{payButton}</div>
      </div>
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
        locale: props.locale ?? 'fr',
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: props.color,
            borderRadius: '12px',
            fontFamily: 'inherit',
          },
          // Exemples (« 1234 1234 1234 1234 », « MM / AA », « CVC ») en gris très
          // clair : ils passaient pour des valeurs pré-remplies. Stripe ne permet
          // pas d'en changer le texte, seulement la couleur. Tous les modules.
          rules: {
            '.Input::placeholder': { color: '#c3c9d2' },
          },
        },
      }}
    >
      <InnerPaymentStep {...props} referenceIdRef={referenceIdRef} />
    </Elements>
  );
}
