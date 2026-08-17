'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { IconMinus, IconPlus, IconBasket, IconStarFilled, IconCreditCard, IconInfoCircle } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import {
  PaymentOptionList, buildExternalPaymentOptions, ExternalPaymentNote,
  externalPaymentCtaLabel, externalPaymentCtaColor,
} from '@/components/payment/ExternalPaymentMethodPicker';
import type { EventTicketType, TenantPaymentMethod } from '@lepefy/types';

// Même pattern de chargement paresseux que (shop)/checkout/CheckoutForm.tsx —
// singleton monté uniquement à l'étape de paiement.
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  }
  return stripePromise;
}

type Step = 'select' | 'info' | 'select-payment' | 'payment';

interface Props {
  event:       { id: string; slug: string; title: string; capacityRemaining: number };
  ticketTypes: EventTicketType[];
  tenant:      { currency: string };
  soldOut:     boolean;
  // Feature row hero (highlights) — propriété/données de page.tsx (voir Task 2),
  // rendue ici entre les cards formule et le récapitulatif pour matcher l'ordre
  // du mockup. Affichée uniquement à l'étape 'select' (le mockup ne montre que
  // cet écran) ; `undefined`/`false` si l'événement n'a pas de highlights.
  featureRow?: ReactNode;
  // Phase 2 — moyens de paiement via lien externe (PayPal/Revolut/autre)
  // éligibles pour ce tenant, même filtre que le checkout boutique.
  externalPaymentMethods?: TenantPaymentMethod[];
}

// Stepper — reflète le state `step` réel du composant (pas de step
// "récapitulatif" séparé). 'select-payment' partage le badge "Paiement" avec
// 'payment' : ce sont deux écrans de la même étape logique (Phase 2, Fix 2
// shop appliqué ici dès le départ — jamais mélangé aux coordonnées).
function EventStepper({ current }: { current: Step }) {
  const steps: { key: Step; n: number; label: string }[] = [
    { key: 'select', n: 1, label: 'Choix des formules' },
    { key: 'info', n: 2, label: 'Vos coordonnées' },
    { key: 'payment', n: 3, label: 'Paiement' },
  ];
  const normalizedCurrent: Step = current === 'select-payment' ? 'payment' : current;
  const activeIndex = steps.findIndex((s) => s.key === normalizedCurrent);

  return (
    <div className="flex items-center justify-center gap-1.5 pb-2" aria-hidden="true">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5">
          {i > 0 && <div className="h-px w-6 sm:w-9 bg-gray-200 shrink-0" />}
          <div className="flex flex-col items-center gap-1.5 w-[74px] sm:w-[110px]">
            <div
              className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
              style={i === activeIndex ? { backgroundColor: 'var(--color-primary)', color: '#fff' } : { backgroundColor: '#e4e0d9', color: '#8a8578' }}
            >
              {s.n}
            </div>
            <div className={`text-[11px] text-center leading-tight ${i === activeIndex ? 'text-gray-900 font-semibold' : 'text-gray-400'}`}>
              {s.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
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

export default function EventCheckoutClient({ event, ticketTypes, tenant, soldOut, featureRow, externalPaymentMethods = [] }: Props) {
  const router = useRouter();
  const { customer: sessionCustomer } = useSessionCustomer();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [step, setStep]   = useState<Step>('select');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  // Pas de mode 'in_store' côté événementiel (contrairement au shop) — seul
  // le choix stripe vs external_link existe, `selectedExternalMethodId ===
  // null` signifie stripe.
  const [selectedExternalMethodId, setSelectedExternalMethodId] = useState<string | null>(null);
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

  function handleContinueToInfo() {
    setError(null);
    if (totalQuantity === 0) {
      setError('Sélectionnez au moins une formule.');
      return;
    }
    if (totalQuantity > event.capacityRemaining) {
      setError('Il ne reste pas assez de places pour cette quantité.');
      return;
    }
    setStep('info');
  }

  function handleBackToSelect() {
    setError(null);
    setStep('select');
  }

  // ── Étape 'info' → 'select-payment' : validation des coordonnées uniquement,
  // aucun appel API (le mode de paiement n'est pas encore choisi). ──────────
  function handleContinueToPayment() {
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError('Nom et email sont obligatoires.');
      return;
    }
    setStep('select-payment');
  }

  function handleBackToInfo() {
    setError(null);
    setStep('info');
  }

  // ── Étape 'select-payment' : confirmation du mode de paiement choisi ─────
  async function handleConfirmPayment() {
    setError(null);
    setIsSubmitting(true);
    try {
      const items = ticketTypes
        .filter((t) => (quantities[t.id] ?? 0) > 0)
        .map((t) => ({ ticket_type_id: t.id, quantity: quantities[t.id] }));

      // ── Paiement via lien externe (PayPal/Revolut/autre) ────────────────
      if (selectedExternalMethodId) {
        const res = await fetch(`/api/events/${event.id}/checkout-external-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items,
            customer_name:  name.trim(),
            customer_email: email.trim(),
            customer_phone: phone.trim() || null,
            externalPaymentMethodId: selectedExternalMethodId,
          }),
        });

        const result = await res.json();
        if (!res.ok) {
          setError(result.error ?? 'Une erreur est survenue.');
          return;
        }

        sessionStorage.setItem('lepefy-pending-event-payment', JSON.stringify({
          requestId: result.requestId,
          link:      result.link,
          amount:    result.amount,
          currency:  result.currency,
          isPaypal:  result.isPaypal,
          label:     result.label,
        }));

        router.push(`${window.location.pathname}/en-attente?ref=${result.requestId}`);
        return;
      }

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
        <EventStepper current={step} />
        {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3 mb-4">{error}</p>}
        <Elements stripe={getStripe()} options={{ clientSecret, locale: 'fr' }}>
          <EventPaymentStep total={total} currency={tenant.currency} onError={setError} />
        </Elements>
      </div>
    );
  }

  // Récapitulatif réutilisé tel quel dans 'select' et 'info' — une ligne par
  // formule sélectionnée (quantité > 0) + total, même logique de calcul
  // qu'avant (quantities/total), seul le markup change (Task 3).
  const selectedTickets = ticketTypes.filter((t) => (quantities[t.id] ?? 0) > 0);
  const summary = totalQuantity > 0 && (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-[18px]">
      <p className="font-display flex items-center gap-2 text-[15px] font-bold text-gray-900 mb-3">
        <IconBasket size={19} style={{ color: 'var(--color-primary)' }} stroke={1.8} />
        Votre réservation
      </p>
      <div>
        {selectedTickets.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 text-[13px] text-gray-600 py-1">
            <span className="min-w-0 truncate">{quantities[t.id]} × {t.label}</span>
            <span className="shrink-0">{formatPrice((quantities[t.id] ?? 0) * t.price, tenant.currency)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2.5 pt-3 border-t border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Total</span>
        <span className="text-xl font-extrabold" style={{ color: 'var(--color-primary)' }}>{formatPrice(total, tenant.currency)}</span>
      </div>
    </div>
  );

  if (step === 'info') {
    return (
      <div className="space-y-5">
        <EventStepper current={step} />

        <button
          type="button"
          onClick={handleBackToSelect}
          disabled={isSubmitting}
          className="text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          ← Retour
        </button>

        {summary}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Vos informations</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom complet" className={inputClass} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className={inputClass} />
          <p className="flex items-center gap-1.5 text-xs text-gray-500 -mt-1.5">
            <IconInfoCircle size={13} className="shrink-0" />
            Vérifiez bien votre adresse — c&apos;est ici que vous recevrez votre billet.
          </p>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Téléphone (optionnel)" className={inputClass} />
        </div>

        {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{error}</p>}

        <button
          onClick={handleContinueToPayment}
          disabled={isSubmitting}
          className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          Continuer vers le paiement
        </button>
      </div>
    );
  }

  // Choix du mode de paiement — jamais mélangé aux coordonnées (même
  // correction que le shop, Phase 1 Fix 2, appliquée ici dès l'introduction
  // du flux external_link) : stripe + un moyen par ligne tenant_payment_methods
  // éligible, cartes radio partagées avec le checkout boutique.
  if (step === 'select-payment') {
    const selectedExternalMethod = externalPaymentMethods.find((pm) => pm.id === selectedExternalMethodId) ?? null;

    const ctaLabel = selectedExternalMethod
      ? externalPaymentCtaLabel(selectedExternalMethod, 'la réservation')
      : 'Continuer vers le paiement';

    const ctaColor = selectedExternalMethod
      ? externalPaymentCtaColor(selectedExternalMethod)
      : 'var(--color-primary)';

    const options = [
      {
        key:      'stripe',
        selected: !selectedExternalMethodId,
        onSelect: () => setSelectedExternalMethodId(null),
        icon:     <IconCreditCard size={16} stroke={1.8} className="text-white" />,
        color:    'var(--color-primary)',
        label:    'Carte bancaire',
        sub:      'Paiement sécurisé, confirmation immédiate',
      },
      ...buildExternalPaymentOptions(externalPaymentMethods, selectedExternalMethodId, setSelectedExternalMethodId),
    ];

    return (
      <div className="space-y-5">
        <EventStepper current={step} />

        <button
          type="button"
          onClick={handleBackToInfo}
          disabled={isSubmitting}
          className="text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          ← Retour
        </button>

        {summary}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-500">Billet envoyé à</p>
            <p className="text-sm font-semibold text-gray-900 truncate">{email}</p>
          </div>
          <button
            type="button"
            onClick={handleBackToInfo}
            disabled={isSubmitting}
            className="text-xs font-semibold shrink-0 hover:underline disabled:opacity-50"
            style={{ color: 'var(--color-primary)' }}
          >
            Modifier
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
          <p className="text-sm font-semibold text-gray-700 mb-3">Mode de paiement</p>
          <PaymentOptionList options={options} />
          {selectedExternalMethod && (
            <ExternalPaymentNote method={selectedExternalMethod} total={total} currency={tenant.currency} />
          )}
        </div>

        {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{error}</p>}

        <p className="text-xs text-gray-500 text-center">
          Après le paiement, pensez à télécharger votre billet directement sur la page de confirmation.
        </p>

        <button
          onClick={handleConfirmPayment}
          disabled={isSubmitting}
          className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: ctaColor }}
        >
          {isSubmitting
            ? 'Traitement…'
            : selectedExternalMethod
              ? `${ctaLabel} — ${formatPrice(total, tenant.currency)}`
              : ctaLabel
          }
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <EventStepper current={step} />

      <h2 className="font-display text-xl font-bold text-gray-900 text-center">Choisissez vos formules</h2>

      <div className="flex flex-col gap-3.5">
        {ticketTypes.map((ticket) => {
          const hasBadge = Boolean(ticket.badge);
          return (
            <div
              key={ticket.id}
              className={`relative bg-white rounded-2xl shadow-sm p-4 sm:p-[18px] ${hasBadge ? 'border-2' : 'border border-gray-100'}`}
              style={hasBadge ? { borderColor: 'var(--color-primary)' } : undefined}
            >
              {hasBadge && (
                <span
                  className="absolute top-0 left-4 -translate-y-1/2 inline-flex items-center gap-1 text-[11px] font-bold text-white px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  <IconStarFilled size={12} /> {ticket.badge}
                </span>
              )}
              <div className={hasBadge ? 'pt-2' : ''}>
                <p className="text-sm font-semibold text-gray-900">{ticket.label}</p>
                {ticket.description && <p className="text-xs text-gray-500 mt-0.5">{ticket.description}</p>}
                <div className="flex items-center justify-between mt-2.5">
                  <span className="text-lg font-bold" style={{ color: 'var(--color-primary)' }}>
                    {formatPrice(ticket.price, tenant.currency)}
                  </span>
                  <div className="flex items-center gap-2.5 shrink-0">
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
              </div>
            </div>
          );
        })}
      </div>

      {featureRow}

      {summary}

      {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{error}</p>}

      <button
        onClick={handleContinueToInfo}
        disabled={totalQuantity === 0}
        className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        Continuer
      </button>
    </div>
  );
}
