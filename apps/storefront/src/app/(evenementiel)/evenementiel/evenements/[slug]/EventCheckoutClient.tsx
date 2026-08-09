'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { IconMinus, IconPlus } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import type { EventTicketType } from '@lepefy/types';

// Même pattern de chargement paresseux que (shop)/checkout/CheckoutForm.tsx —
// singleton monté uniquement à l'étape de paiement.
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  }
  return stripePromise;
}

interface Props {
  event:       { id: string; slug: string; title: string; capacityRemaining: number };
  ticketTypes: EventTicketType[];
  tenant:      { currency: string };
  soldOut:     boolean;
}

function EventPaymentStep({ total, currency, onError }: { total: number; currency: string; onError: (msg: string) => void }) {
  const stripe   = useStripe();
  const elements = useElements();
  const router   = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    if (!stripe || !elements) return;
    setIsConfirming(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/evenementiel` },
      redirect: 'if_required',
    });

    if (error) {
      onError(error.message ?? 'Erreur lors du paiement.');
      setIsConfirming(false);
    } else {
      router.push(`${window.location.pathname}/confirmation?payment_intent=${paymentIntent?.id ?? ''}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
        <p className="text-sm font-semibold text-gray-700 mb-4">Paiement sécurisé</p>
        <PaymentElement />
      </div>
      <button
        onClick={handleConfirm}
        disabled={isConfirming || !stripe || !elements}
        className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {isConfirming ? 'Traitement en cours…' : `Payer ${formatPrice(total, currency)}`}
      </button>
    </div>
  );
}

export default function EventCheckoutClient({ event, ticketTypes, tenant, soldOut }: Props) {
  const { customer: sessionCustomer } = useSessionCustomer();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [step, setStep]   = useState<'select' | 'payment'>('select');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!sessionCustomer || prefilledRef.current) return;
    prefilledRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/customers/me');
        if (!res.ok) return;
        const profile = await res.json();
        if (!name && profile.fullName) setName(profile.fullName);
        if (!email && profile.email) setEmail(profile.email);
        if (!phone && profile.phone) setPhone(profile.phone);
      } catch {
        // Confort — le formulaire reste vide en cas d'échec, checkout guest continue.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCustomer]);

  const totalQuantity = Object.values(quantities).reduce((s, q) => s + q, 0);
  const total = ticketTypes.reduce((s, t) => s + (quantities[t.id] ?? 0) * t.price, 0);

  function setQuantity(ticketId: string, delta: number) {
    setQuantities((prev) => {
      const next = Math.max(0, (prev[ticketId] ?? 0) + delta);
      return { ...prev, [ticketId]: next };
    });
  }

  async function handleSubmit() {
    setError(null);
    if (totalQuantity === 0) {
      setError('Sélectionnez au moins une formule.');
      return;
    }
    if (totalQuantity > event.capacityRemaining) {
      setError('Il ne reste pas assez de places pour cette quantité.');
      return;
    }
    if (!name.trim() || !email.trim()) {
      setError('Nom et email sont obligatoires.');
      return;
    }

    setIsSubmitting(true);
    try {
      const items = ticketTypes
        .filter((t) => (quantities[t.id] ?? 0) > 0)
        .map((t) => ({ ticket_type_id: t.id, quantity: quantities[t.id] }));

      const res = await fetch(`/api/events/${event.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          customer_name: name.trim(),
          customer_email: email.trim(),
          customer_phone: phone.trim() || null,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? 'Une erreur est survenue.');
        return;
      }

      setClientSecret(result.clientSecret);
      setStep('payment');
    } catch {
      setError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (soldOut) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
        <p className="text-sm font-semibold text-gray-700">Cet événement est complet.</p>
      </div>
    );
  }

  const inputClass =
    'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  if (step === 'payment' && clientSecret) {
    return (
      <div>
        {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3 mb-4">{error}</p>}
        <Elements stripe={getStripe()} options={{ clientSecret, locale: 'fr' }}>
          <EventPaymentStep total={total} currency={tenant.currency} onError={setError} />
        </Elements>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Choisissez vos formules</p>
        <div className="space-y-3">
          {ticketTypes.map((ticket) => (
            <div key={ticket.id} className="flex items-center justify-between gap-3 py-1">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{ticket.label}</p>
                {ticket.description && <p className="text-xs text-gray-500 line-clamp-1">{ticket.description}</p>}
                <p className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {formatPrice(ticket.price, tenant.currency)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setQuantity(ticket.id, -1)}
                  className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center text-gray-500"
                >
                  <IconMinus size={14} />
                </button>
                <span className="w-5 text-center text-sm font-semibold">{quantities[ticket.id] ?? 0}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(ticket.id, 1)}
                  className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center text-gray-500"
                >
                  <IconPlus size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {totalQuantity > 0 && (
        <div className="bg-gray-50 rounded-2xl p-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Total ({totalQuantity} place{totalQuantity > 1 ? 's' : ''})</span>
          <span className="text-lg font-bold text-gray-900">{formatPrice(total, tenant.currency)}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Vos informations</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom complet" className={inputClass} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className={inputClass} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Téléphone (optionnel)" className={inputClass} />
      </div>

      {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={isSubmitting || totalQuantity === 0}
        className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {isSubmitting ? 'Traitement…' : 'Continuer vers le paiement'}
      </button>
    </div>
  );
}
