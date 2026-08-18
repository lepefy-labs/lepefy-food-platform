'use client';

import { useState, useEffect, useRef } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { IconCheck } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { logFunnelEvent, registerAbandonmentListener } from '@/lib/funnelLog';

// Chargement paresseux, même pattern que (shop)/checkout/CheckoutForm.tsx —
// appelé uniquement une fois le montant validé côté serveur (clientSecret
// reçu), jamais au premier rendu de /card.
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  }
  return stripePromise;
}

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 2000;

type Lang = 'fr' | 'it';

interface QuickPayCopy {
  amountLabel:       string;
  amountPlaceholder: string;
  nameLabel:         string;
  emailLabel:        string;
  submit:            string;
  processing:        string;
  payButton:         string;
  thanks:            string;
  genericError:      string;
  invalidAmount:     string;
}

const COPY: Record<Lang, QuickPayCopy> = {
  fr: {
    amountLabel:       'Montant à payer',
    amountPlaceholder: 'Montant en €',
    nameLabel:         'Nom (optionnel)',
    emailLabel:        'Email (optionnel)',
    submit:            'Continuer',
    processing:        'Traitement en cours…',
    payButton:         'Payer',
    thanks:            'Merci ! Paiement reçu.',
    genericError:      'Une erreur est survenue. Veuillez réessayer.',
    invalidAmount:     `Le montant doit être compris entre ${MIN_AMOUNT} et ${MAX_AMOUNT} €.`,
  },
  it: {
    amountLabel:       'Importo da pagare',
    amountPlaceholder: 'Importo in €',
    nameLabel:         'Nome (facoltativo)',
    emailLabel:        'Email (facoltativa)',
    submit:            'Continua',
    processing:        'Elaborazione in corso…',
    payButton:         'Paga',
    thanks:            'Grazie! Pagamento ricevuto.',
    genericError:      'Si è verificato un errore. Riprova.',
    invalidAmount:     `L'importo deve essere compreso tra ${MIN_AMOUNT} e ${MAX_AMOUNT} €.`,
  },
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function QuickPayPaymentStep({
  amount,
  currency,
  color,
  copy,
  quickPaymentId,
  onError,
  onSucceeded,
}: {
  amount:      number;
  currency:    string;
  color:       string;
  copy:        QuickPayCopy;
  quickPaymentId: string | null;
  onError:     (msg: string) => void;
  onSucceeded: () => void;
}) {
  const stripe   = useStripe();
  const elements = useElements();
  const [isConfirming, setIsConfirming] = useState(false);
  const hasSucceededRef = useRef(false);

  useEffect(() => {
    return registerAbandonmentListener({
      module:       'card',
      reference_id: quickPaymentId,
      hasSucceededRef,
    });
  }, [quickPaymentId]);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setIsConfirming(true);

    logFunnelEvent({ module: 'card', event_type: 'confirm_attempted', reference_id: quickPaymentId });

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/card`,
      },
      redirect: 'if_required',
    });

    if (error) {
      logFunnelEvent({
        module: 'card',
        event_type: 'confirm_error',
        reference_id: quickPaymentId,
        detail: { code: error.code ?? null, type: error.type ?? null },
      });
      onError(error.message ?? copy.genericError);
      setIsConfirming(false);
    } else {
      hasSucceededRef.current = true;
      logFunnelEvent({ module: 'card', event_type: 'confirm_succeeded_client', reference_id: quickPaymentId });
      onSucceeded();
    }
  }

  return (
    <div className="space-y-3">
      <PaymentElement />
      <button
        type="button"
        onClick={handleConfirm}
        disabled={isConfirming || !stripe || !elements}
        className="w-full py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: color }}
      >
        {isConfirming ? copy.processing : `${copy.payButton} ${formatPrice(amount, currency)}`}
      </button>
    </div>
  );
}

export function CardQuickPay({
  tenantColor,
  currency,
  lang,
}: {
  tenantColor: string;
  currency:    string;
  lang:        Lang;
}) {
  const copy = COPY[lang];

  const [amount, setAmount]                 = useState('');
  const [customerName, setCustomerName]     = useState('');
  const [customerEmail, setCustomerEmail]   = useState('');
  const [clientSecret, setClientSecret]     = useState<string | null>(null);
  const [confirmedAmount, setConfirmedAmount] = useState(0);
  const [quickPaymentId, setQuickPaymentId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting]     = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [paid, setPaid]                     = useState(false);

  // Retrieve au montage — si Stripe a redirigé vers /card en plein écran
  // (3D Secure), le state React (clientSecret, paid) est perdu au retour :
  // on relit le statut du PaymentIntent depuis les query params ajoutés
  // automatiquement par Stripe (payment_intent_client_secret).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const secretFromUrl = params.get('payment_intent_client_secret');
    if (!secretFromUrl) return;

    getStripe()!.then((stripeInstance) => {
      if (!stripeInstance) return;
      stripeInstance.retrievePaymentIntent(secretFromUrl).then(({ paymentIntent }) => {
        if (paymentIntent?.status === 'succeeded') {
          setPaid(true);
        } else if (paymentIntent?.status === 'requires_action') {
          logFunnelEvent({ module: 'card', event_type: 'requires_action', reference_id: quickPaymentId });
        }
        // Pulizia URL — evita che un refresh rilegga lo stesso client_secret.
        window.history.replaceState({}, '', window.location.pathname);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit() {
    const parsed = parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < MIN_AMOUNT || parsed > MAX_AMOUNT) {
      setError(copy.invalidAmount);
      return;
    }
    if (customerEmail && !isValidEmail(customerEmail)) {
      setError(copy.genericError);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/card/quick-pay', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          amount:         parsed,
          customerName:   customerName.trim() || null,
          customerEmail:  customerEmail.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? copy.genericError);
        return;
      }
      setConfirmedAmount(parsed);
      setQuickPaymentId(data.quickPaymentId);
      setClientSecret(data.clientSecret);
      logFunnelEvent({
        module:       'card',
        event_type:   'elements_mounted',
        reference_id: data.quickPaymentId,
        detail:       { amount: parsed },
      });
    } catch {
      setError(copy.genericError);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (paid) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium" style={{ color: tenantColor }}>
        <IconCheck size={16} stroke={2.2} />
        {copy.thanks}
      </div>
    );
  }

  if (clientSecret) {
    return (
      <div>
        <Elements stripe={getStripe()} options={{ clientSecret, locale: lang === 'it' ? 'it' : 'fr' }}>
          <QuickPayPaymentStep
            amount={confirmedAmount}
            currency={currency}
            color={tenantColor}
            copy={copy}
            quickPaymentId={quickPaymentId}
            onError={setError}
            onSucceeded={() => setPaid(true)}
          />
        </Elements>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="number"
        inputMode="decimal"
        min={MIN_AMOUNT}
        max={MAX_AMOUNT}
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={copy.amountPlaceholder}
        className="w-full rounded-lg px-3 py-2 text-sm border border-gray-200 bg-white focus:outline-none focus:ring-2"
        style={{ '--tw-ring-color': tenantColor } as React.CSSProperties}
      />
      <input
        type="text"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        placeholder={copy.nameLabel}
        className="w-full rounded-lg px-3 py-2 text-sm border border-gray-200 bg-white"
      />
      <input
        type="email"
        inputMode="email"
        value={customerEmail}
        onChange={(e) => setCustomerEmail(e.target.value)}
        placeholder={copy.emailLabel}
        className="w-full rounded-lg px-3 py-2 text-sm border border-gray-200 bg-white"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting || !amount}
        className="w-full py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: tenantColor }}
      >
        {isSubmitting ? copy.processing : copy.submit}
      </button>
    </div>
  );
}
