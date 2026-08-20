'use client';

import { useState } from 'react';
import { IconCheck } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import { usePaymentRedirectRecovery } from '@/lib/payments/usePaymentRedirectRecovery';

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
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [confirmedAmount, setConfirmedAmount] = useState(0);
  const [error, setError]                   = useState<string | null>(null);
  const [paid, setPaid]                     = useState(false);

  usePaymentRedirectRecovery('card', () => setPaid(true));

  // ── "Continuer" : validation uniquement, aucun appel réseau — le
  // PaymentIntent n'est créé qu'au clic sur "Payer" (deferred intent
  // creation), dans createIntent ci-dessous. ─────────────────────────────
  function handleContinue() {
    const parsed = parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < MIN_AMOUNT || parsed > MAX_AMOUNT) {
      setError(copy.invalidAmount);
      return;
    }
    if (customerEmail && !isValidEmail(customerEmail)) {
      setError(copy.genericError);
      return;
    }
    setError(null);
    setConfirmedAmount(parsed);
    setShowPaymentStep(true);
  }

  // Business logic identique à l'ancienne route appelée depuis "Continuer" :
  // validation serveur + insert tenant_card_payments + création du
  // PaymentIntent — seul le moment de l'appel change (clic "Payer").
  async function createIntent() {
    try {
      const res = await fetch('/api/card/quick-pay', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          amount:        confirmedAmount,
          customerName:  customerName.trim() || null,
          customerEmail: customerEmail.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error ?? copy.genericError };
      return { clientSecret: data.clientSecret, reference_id: data.quickPaymentId as string };
    } catch {
      // Réseau coupé ou réponse illisible : on retourne une erreur gérée
      // plutôt que de laisser l'exception remonter et figer le bouton.
      return { error: copy.genericError };
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

  if (showPaymentStep) {
    return (
      <div>
        <StripePaymentStep
          module="card"
          amount={confirmedAmount}
          currency={currency}
          color={tenantColor}
          returnUrl={`${window.location.origin}/card`}
          referenceId={null}
          payLabel={`${copy.payButton} ${formatPrice(confirmedAmount, currency)}`}
          processingLabel={copy.processing}
          createIntent={createIntent}
          onError={setError}
          onSucceeded={() => setPaid(true)}
        />
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
        onClick={handleContinue}
        disabled={!amount}
        className="w-full py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: tenantColor }}
      >
        {copy.submit}
      </button>
    </div>
  );
}
