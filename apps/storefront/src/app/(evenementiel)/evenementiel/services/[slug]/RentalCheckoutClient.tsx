'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { IconMinus, IconPlus, IconCreditCard } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import {
  PaymentOptionList, buildExternalPaymentOptions, ExternalPaymentNote,
  externalPaymentCtaLabel, externalPaymentCtaColor,
} from '@/components/payment/ExternalPaymentMethodPicker';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import { usePaymentRedirectRecovery } from '@/lib/payments/usePaymentRedirectRecovery';
import type { RentalItem, TenantPaymentMethod } from '@lepefy/types';

interface Props {
  service:     { id: string; slug: string; title: string };
  rentalItems: RentalItem[];
  tenant:      { currency: string };
  externalPaymentMethods?: TenantPaymentMethod[];
}

export default function RentalCheckoutClient({ service, rentalItems, tenant, externalPaymentMethods = [] }: Props) {
  const router = useRouter();
  const { customer: sessionCustomer } = useSessionCustomer();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [pickupDate, setPickupDate] = useState('');
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // 'select' → 'choose-payment' → 'payment' : même correction structurelle
  // qu'en Phase 1 (shop) — le choix du moyen de paiement n'a jamais été mêlé
  // au formulaire, jamais introduit comme option accolée dedans.
  const [step, setStep]   = useState<'select' | 'choose-payment' | 'payment'>('select');
  const [showPaymentStep, setShowPaymentStep] = useState(false);

  usePaymentRedirectRecovery('rental', () => {
    router.push(`${window.location.pathname}/confirmation`);
  });
  // Pas de mode 'in_store' pour la location — seul le choix stripe vs
  // external_link existe, `selectedExternalMethodId === null` signifie stripe.
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
        // Confort — checkout guest continue en cas d'échec.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCustomer]);

  const totalQuantity = Object.values(quantities).reduce((s, q) => s + q, 0);
  const total = rentalItems.reduce((s, i) => s + (quantities[i.id] ?? 0) * i.price_per_unit, 0);

  function setQuantity(itemId: string, delta: number, max: number) {
    setQuantities((prev) => {
      const next = Math.min(max, Math.max(0, (prev[itemId] ?? 0) + delta));
      return { ...prev, [itemId]: next };
    });
  }

  // ── Étape 'select' → 'choose-payment' : validation uniquement, aucun appel
  // API (le mode de paiement n'est pas encore choisi). ─────────────────────
  function handleContinueToPayment() {
    setError(null);
    if (totalQuantity === 0) {
      setError('Sélectionnez au moins un article.');
      return;
    }
    if (!pickupDate) {
      setError('Indiquez une date de retrait.');
      return;
    }
    if (!name.trim() || !email.trim()) {
      setError('Nom et email sont obligatoires.');
      return;
    }
    setStep('choose-payment');
  }

  function handleBackToSelect() {
    setError(null);
    setStep('select');
  }

  // Business logic identique à l'ancienne route appelée depuis
  // 'choose-payment' — validation stock + création du PaymentIntent — seul
  // le moment de l'appel change (clic "Payer" dans StripePaymentStep).
  async function createIntent() {
    const items = rentalItems
      .filter((i) => (quantities[i.id] ?? 0) > 0)
      .map((i) => ({ rental_item_id: i.id, quantity: quantities[i.id] }));

    const res = await fetch('/api/rental/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_offering_id: service.id,
        items,
        pickup_date: pickupDate,
        customer_name: name.trim(),
        customer_email: email.trim(),
        customer_phone: phone.trim() || null,
      }),
    });

    const result = await res.json();
    if (!res.ok) return { error: result.error ?? 'Une erreur est survenue.' };
    return { clientSecret: result.clientSecret };
  }

  // ── Étape 'choose-payment' : confirmation du mode de paiement choisi ─────
  async function handleConfirmPayment() {
    setError(null);
    setIsSubmitting(true);
    try {
      const items = rentalItems
        .filter((i) => (quantities[i.id] ?? 0) > 0)
        .map((i) => ({ rental_item_id: i.id, quantity: quantities[i.id] }));

      // ── Paiement via lien externe (PayPal/Revolut/autre) ────────────────
      if (selectedExternalMethodId) {
        const res = await fetch('/api/rental/checkout-external-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service_offering_id: service.id,
            items,
            pickup_date: pickupDate,
            customer_name: name.trim(),
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

        sessionStorage.setItem('lepefy-pending-rental-payment', JSON.stringify({
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

      // ── Paiement Stripe : aucun appel réseau ici (deferred intent
      // creation) — le PaymentIntent n'est créé que dans createIntent, au
      // clic sur "Payer" dans StripePaymentStep. ──────────────────────────
      setShowPaymentStep(true);
      setStep('payment');
    } catch {
      setError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass =
    'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  if (rentalItems.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
        <p className="text-sm text-gray-500">Aucun article disponible pour le moment.</p>
      </div>
    );
  }

  if (step === 'payment' && showPaymentStep) {
    return (
      <div>
        {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3 mb-4">{error}</p>}
        <StripePaymentStep
          module="rental"
          amount={total}
          currency={tenant.currency}
          color="var(--color-primary)"
          returnUrl={`${window.location.origin}/evenementiel`}
          referenceId={service.id}
          payLabel={`Payer ${formatPrice(total, tenant.currency)}`}
          processingLabel="Traitement en cours…"
          createIntent={createIntent}
          onError={setError}
          onSucceeded={(paymentIntentId) => {
            router.push(`${window.location.pathname}/confirmation?payment_intent=${paymentIntentId ?? ''}`);
          }}
        />
      </div>
    );
  }

  // Choix du mode de paiement — jamais mélangé aux coordonnées (même
  // correction structurelle que le shop, Phase 1 Fix 2, appliquée ici dès
  // l'introduction du flux external_link) : stripe + un moyen par ligne
  // tenant_payment_methods éligible, cartes radio partagées avec shop/billetterie.
  if (step === 'choose-payment') {
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
        <button
          type="button"
          onClick={handleBackToSelect}
          disabled={isSubmitting}
          className="text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          ← Retour
        </button>

        {totalQuantity > 0 && (
          <div className="bg-gray-50 rounded-2xl p-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Total ({totalQuantity} article{totalQuantity > 1 ? 's' : ''})</span>
            <span className="text-lg font-bold text-gray-900">{formatPrice(total, tenant.currency)}</span>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">Mode de paiement</p>
          <PaymentOptionList options={options} />
          {selectedExternalMethod && (
            <ExternalPaymentNote method={selectedExternalMethod} total={total} currency={tenant.currency} />
          )}
        </div>

        {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{error}</p>}

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
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Catalogue matériel</p>
        <div className="space-y-3">
          {rentalItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-1">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{item.name}</p>
                {item.category && <p className="text-xs text-gray-400">{item.category}</p>}
                <p className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {formatPrice(item.price_per_unit, tenant.currency)} / unité
                  {item.stock_quantity <= 0 && <span className="text-red-500 ml-2">Épuisé</span>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setQuantity(item.id, -1, item.stock_quantity)}
                  className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center text-gray-500"
                >
                  <IconMinus size={14} />
                </button>
                <span className="w-5 text-center text-sm font-semibold">{quantities[item.id] ?? 0}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(item.id, 1, item.stock_quantity)}
                  disabled={item.stock_quantity <= 0}
                  className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 disabled:opacity-30"
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
          <span className="text-sm font-semibold text-gray-700">Total ({totalQuantity} article{totalQuantity > 1 ? 's' : ''})</span>
          <span className="text-lg font-bold text-gray-900">{formatPrice(total, tenant.currency)}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Retrait et coordonnées</p>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Date de retrait souhaitée</label>
          <input value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} type="date" className={inputClass} />
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom complet" className={inputClass} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className={inputClass} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Téléphone (optionnel)" className={inputClass} />
      </div>

      {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{error}</p>}

      <button
        onClick={handleContinueToPayment}
        disabled={totalQuantity === 0}
        className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        Continuer vers le paiement
      </button>
    </div>
  );
}
