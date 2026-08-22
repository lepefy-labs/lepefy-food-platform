'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { IconBasket, IconCheck, IconCreditCard, IconInfoCircle, IconMinus, IconPlus, IconStarFilled } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import {
  PaymentOptionList,
  buildExternalPaymentOptions,
  ExternalPaymentNote,
  externalPaymentCtaColor,
  externalPaymentCtaLabel,
} from '@/components/payment/ExternalPaymentMethodPicker';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import { usePaymentRedirectRecovery } from '@/lib/payments/usePaymentRedirectRecovery';
import type { EventTicketType, TenantPaymentMethod } from '@lepefy/types';

type Step = 'select' | 'info' | 'select-payment' | 'payment';

interface Props {
  event: { id: string; slug: string; title: string; capacityRemaining: number };
  ticketTypes: EventTicketType[];
  tenant: { currency: string };
  soldOut: boolean;
  featureRow?: ReactNode;
  externalPaymentMethods?: TenantPaymentMethod[];
  isE2ETest?: boolean;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function EventStepper({ current }: { current: Step }) {
  const normalized = current === 'select-payment' ? 'payment' : current;
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'select', label: 'Formules' },
    { key: 'info', label: 'Coordonnées' },
    { key: 'payment', label: 'Paiement' },
  ];
  const activeIndex = steps.findIndex((step) => step.key === normalized);

  return (
    <ol className="mx-auto grid max-w-[760px] grid-cols-3 gap-2" aria-label="Étapes de réservation">
      {steps.map((step, index) => (
        <li key={step.key} className="relative flex flex-col items-center text-center">
          {index > 0 && <span className="absolute right-1/2 top-4 -z-0 h-px w-full bg-black/10" aria-hidden="true" />}
          <span className={`relative z-[1] flex size-8 items-center justify-center rounded-full text-xs font-bold ${index <= activeIndex ? 'bg-[var(--color-primary)] text-white' : 'bg-[#e9e3d8] text-gray-500'}`}>{index + 1}</span>
          <span className={`mt-1.5 text-[11px] sm:text-xs ${index === activeIndex ? 'font-bold text-gray-900' : 'text-gray-500'}`}>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function EventCheckoutClient({ event, ticketTypes, tenant, soldOut, featureRow, externalPaymentMethods = [], isE2ETest = false }: Props) {
  const router = useRouter();
  const { customer: sessionCustomer } = useSessionCustomer();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<Step>('select');
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [selectedExternalMethodId, setSelectedExternalMethodId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePaymentRedirectRecovery('event', () => {
    router.push(`${window.location.pathname}/confirmation`);
  });

  const draftRestoredRef = useRef(false);
  useEffect(() => {
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    try {
      const raw = sessionStorage.getItem('lepefy-event-checkout-draft');
      if (!raw) return;
      const draft = JSON.parse(raw) as { eventId: string; quantities: Record<string, number>; name: string; email: string; phone: string };
      if (draft.eventId !== event.id) return;
      setQuantities(draft.quantities);
      setName(draft.name);
      setEmail(draft.email);
      setPhone(draft.phone);
      setStep('select-payment');
    } catch {
      // Corrupt draft: start normally.
    }
  }, [event.id]);

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
        // Guest checkout remains available.
      }
    })();
  }, [sessionCustomer, name, email, phone]);

  const totalQuantity = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const total = ticketTypes.reduce((sum, ticket) => sum + (quantities[ticket.id] ?? 0) * ticket.price, 0);
  const selectedTickets = ticketTypes.filter((ticket) => (quantities[ticket.id] ?? 0) > 0);

  function setQuantity(ticketId: string, delta: number) {
    setQuantities((previous) => ({ ...previous, [ticketId]: Math.max(0, (previous[ticketId] ?? 0) + delta) }));
  }

  function handleContinueToInfo() {
    setError(null);
    if (totalQuantity === 0) return setError('Sélectionnez au moins une formule.');
    if (totalQuantity > event.capacityRemaining) return setError('Il ne reste pas assez de places pour cette quantité.');
    setStep('info');
  }

  function handleContinueToPayment() {
    setError(null);
    if (!name.trim() || !email.trim()) return setError('Nom et email sont obligatoires.');
    if (!isValidEmail(email)) {
      setEmailTouched(true);
      return setError('Adresse email invalide.');
    }
    sessionStorage.setItem('lepefy-event-checkout-draft', JSON.stringify({ eventId: event.id, quantities, name: name.trim(), email: email.trim(), phone: phone.trim() }));
    setStep('select-payment');
  }

  async function createIntent() {
    const items = selectedTickets.map((ticket) => ({ ticket_type_id: ticket.id, quantity: quantities[ticket.id] }));
    try {
      const res = await fetch(`/api/events/${event.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, customer_name: name.trim(), customer_email: email.trim(), customer_phone: phone.trim() || null }),
      });
      const result = await res.json();
      if (!res.ok) return { error: result.error ?? 'Une erreur est survenue.' };
      return { clientSecret: result.clientSecret };
    } catch {
      return { error: 'Une erreur est survenue.' };
    }
  }

  async function handleConfirmPayment() {
    setError(null);
    setIsSubmitting(true);
    try {
      const items = selectedTickets.map((ticket) => ({ ticket_type_id: ticket.id, quantity: quantities[ticket.id] }));
      if (selectedExternalMethodId) {
        const res = await fetch(`/api/events/${event.id}/checkout-external-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, customer_name: name.trim(), customer_email: email.trim(), customer_phone: phone.trim() || null, externalPaymentMethodId: selectedExternalMethodId }),
        });
        const result = await res.json();
        if (!res.ok) {
          setError(result.error ?? 'Une erreur est survenue.');
          return;
        }
        sessionStorage.setItem('lepefy-pending-event-payment', JSON.stringify({ requestId: result.requestId, link: result.link, amount: result.amount, currency: result.currency, isPaypal: result.isPaypal, label: result.label, customerEmail: email.trim(), eventSlug: event.slug }));
        router.push(`${window.location.pathname}/en-attente?ref=${result.requestId}`);
        return;
      }
      sessionStorage.removeItem('lepefy-event-checkout-draft');
      setShowPaymentStep(true);
      setStep('payment');
    } catch {
      setError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass = 'min-h-11 w-full rounded-xl border border-black/10 bg-[#fffdf9] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-primary)_18%,transparent)]';

  if (soldOut) {
    return <div className="rounded-3xl border border-red-100 bg-white p-7 text-center shadow-sm"><p className="font-display text-2xl font-semibold text-gray-900">Cet événement est complet.</p><p className="mt-2 text-sm text-gray-500">Aucune réservation supplémentaire n’est disponible pour le moment.</p></div>;
  }

  const summary = (
    <div className={`rounded-[24px] border border-black/[0.06] bg-white p-5 shadow-sm transition-all ${selectedTickets.length === 0 ? 'lg:p-4' : ''}`}>
      <div className="flex items-center gap-2"><IconBasket size={19} className="text-[var(--color-primary)]" /><h3 className="font-display text-xl font-semibold">Votre réservation</h3></div>
      {selectedTickets.length === 0 ? <p className="mt-3 text-sm leading-relaxed text-gray-500">Choisissez une formule pour commencer.</p> : (
        <div className="mt-4 divide-y divide-black/[0.06]">
          {selectedTickets.map((ticket) => (
            <div key={ticket.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="min-w-0 truncate">{quantities[ticket.id]} × {ticket.label}</span><span className="shrink-0 font-semibold">{formatPrice((quantities[ticket.id] ?? 0) * ticket.price, tenant.currency)}</span></div>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-black/[0.08] pt-4"><span className="text-sm font-semibold">Total</span><span className="text-xl font-bold">{formatPrice(total, tenant.currency)}</span></div>
      {step === 'select' && totalQuantity > 0 && (
        <button onClick={handleContinueToInfo} className="mt-4 hidden min-h-12 w-full rounded-xl bg-[var(--color-primary)] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--color-primary-dark)] lg:block">Continuer</button>
      )}
    </div>
  );

  if (step === 'payment' && showPaymentStep) {
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <EventStepper current={step} />
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="rounded-3xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
          <StripePaymentStep module="event" isTest={isE2ETest} amount={total} currency={tenant.currency} color="var(--color-primary)" returnUrl={`${window.location.origin}/evenementiel`} referenceId={event.id} payLabel={`Payer ${formatPrice(total, tenant.currency)}`} processingLabel="Traitement en cours…" billingCountryHint="Si un pays est demandé ci-dessous, indiquez celui associé à votre carte bancaire (facturation), pas votre position actuelle." createIntent={createIntent} onError={setError} onSucceeded={(paymentIntentId) => router.push(`${window.location.pathname}/confirmation?payment_intent=${paymentIntentId ?? ''}`)} />
        </div>
      </div>
    );
  }

  if (step === 'info') {
    const emailInvalid = emailTouched && email.trim().length > 0 && !isValidEmail(email);
    return (
      <div className="space-y-5">
        <EventStepper current={step} />
        <button type="button" onClick={() => { setError(null); setStep('select'); }} className="min-h-11 rounded-xl px-2 text-sm font-semibold text-gray-600">← Retour</button>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="rounded-3xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-display text-2xl font-semibold">Vos coordonnées</h2>
            <div className="mt-5 space-y-3">
              <label className="block text-xs font-medium text-gray-600">Nom complet *<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={`${inputClass} mt-1.5`} /></label>
              <label className="block text-xs font-medium text-gray-600">Email *<input value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setEmailTouched(true)} type="email" autoComplete="email" className={`${inputClass} mt-1.5 ${emailInvalid ? 'border-red-300' : ''}`} /></label>
              {emailInvalid ? <p className="text-xs text-red-600">Adresse email invalide : vérifiez le format.</p> : <p className="flex items-center gap-1.5 text-xs text-gray-500"><IconInfoCircle size={14} />Votre billet sera envoyé à cette adresse.</p>}
              <label className="block text-xs font-medium text-gray-600">Téléphone<input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" className={`${inputClass} mt-1.5`} /></label>
            </div>
            {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
            <button onClick={handleContinueToPayment} className="mt-5 min-h-12 w-full rounded-xl bg-[var(--color-primary)] px-5 py-3 text-sm font-bold text-white">Continuer</button>
          </div>
          <aside className="lg:sticky lg:top-[92px]">{summary}</aside>
        </div>
      </div>
    );
  }

  if (step === 'select-payment') {
    const selectedExternalMethod = externalPaymentMethods.find((method) => method.id === selectedExternalMethodId) ?? null;
    const ctaLabel = selectedExternalMethod ? externalPaymentCtaLabel(selectedExternalMethod, 'la réservation') : 'Continuer vers le paiement';
    const ctaColor = selectedExternalMethod ? externalPaymentCtaColor(selectedExternalMethod) : 'var(--color-primary)';
    const options = [
      { key: 'stripe', selected: !selectedExternalMethodId, onSelect: () => setSelectedExternalMethodId(null), icon: <IconCreditCard size={16} stroke={1.8} className="text-white" />, color: 'var(--color-primary)', label: 'Carte bancaire', sub: 'Paiement sécurisé, confirmation immédiate' },
      ...buildExternalPaymentOptions(externalPaymentMethods, selectedExternalMethodId, setSelectedExternalMethodId),
    ];

    return (
      <div className="space-y-5">
        <EventStepper current={step} />
        <button type="button" onClick={() => { setError(null); setStep('info'); }} disabled={isSubmitting} className="min-h-11 rounded-xl px-2 text-sm font-semibold text-gray-600">← Retour</button>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="rounded-3xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-display text-2xl font-semibold">Méthode de paiement</h2>
            <div className="mt-5"><PaymentOptionList options={options} /></div>
            {selectedExternalMethod && <ExternalPaymentNote method={selectedExternalMethod} total={total} currency={tenant.currency} />}
            <div className="mt-5 rounded-2xl bg-[#f8f4ec] p-4"><p className="text-xs text-gray-500">Billet envoyé à</p><p className="mt-1 truncate text-sm font-semibold text-gray-900">{email}</p><button type="button" onClick={() => setStep('info')} className="mt-2 min-h-11 text-xs font-bold text-[var(--color-primary)]">Modifier les coordonnées</button></div>
            {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            <button onClick={handleConfirmPayment} disabled={isSubmitting} className="mt-5 min-h-12 w-full rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: ctaColor }}>{isSubmitting ? 'Traitement…' : selectedExternalMethod ? `${ctaLabel} · ${formatPrice(total, tenant.currency)}` : ctaLabel}</button>
          </div>
          <aside className="lg:sticky lg:top-[92px]">{summary}</aside>
        </div>
      </div>
    );
  }

  return (
    <div className={totalQuantity > 0 ? 'pb-[104px] lg:pb-0' : ''}>
      <EventStepper current={step} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div>
          {featureRow}
          <section className={featureRow ? 'mt-6' : ''}>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">Réservation</p>
              <h2 className="mt-1 font-display text-3xl font-semibold text-gray-900">Choisis ta formule</h2>
              <p className="mt-2 text-sm text-gray-500">Sélectionne le nombre de billets souhaité pour chaque formule.</p>
            </div>
            <div className="mt-5 space-y-3">
              {ticketTypes.map((ticket) => {
                const quantity = quantities[ticket.id] ?? 0;
                const selected = quantity > 0;
                return (
                  <article key={ticket.id} className={`relative rounded-[22px] border p-5 shadow-sm transition-colors ${selected ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_5%,white)]' : ticket.badge ? 'border-[color-mix(in_srgb,var(--color-primary)_35%,white)] bg-white' : 'border-black/[0.06] bg-white'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      {ticket.badge && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)] px-2.5 py-1 text-[10px] font-bold text-white"><IconStarFilled size={11} />{ticket.badge}</span>}
                      {selected && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700"><IconCheck size={11} />Sélectionnée</span>}
                    </div>
                    <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-3">
                          <h3 className="text-base font-bold text-gray-900">{ticket.label}</h3>
                          <p className="text-lg font-bold text-[var(--color-primary)]">{formatPrice(ticket.price, tenant.currency)}</p>
                        </div>
                        {ticket.description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-gray-500">{ticket.description}</p>}
                      </div>
                      <div className="inline-flex h-12 items-center overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm" aria-label={`Quantité pour ${ticket.label}`}>
                        <button type="button" aria-label={`Retirer une formule ${ticket.label}`} onClick={() => setQuantity(ticket.id, -1)} disabled={quantity === 0} className="flex h-12 w-11 items-center justify-center text-gray-700 disabled:opacity-35"><IconMinus size={16} /></button>
                        <span className="flex h-12 w-10 items-center justify-center border-x border-black/10 text-base font-bold">{quantity}</span>
                        <button type="button" aria-label={`Ajouter une formule ${ticket.label}`} onClick={() => setQuantity(ticket.id, 1)} className="flex h-12 w-11 items-center justify-center text-gray-700"><IconPlus size={16} /></button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
        </div>
        <aside className="sticky top-[92px] hidden lg:block">{summary}</aside>
      </div>

      {totalQuantity > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_rgba(0,0,0,.08)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-[620px] items-center gap-3">
            <div className="min-w-0 flex-1"><p className="text-xs text-gray-500">{totalQuantity} billet{totalQuantity > 1 ? 's' : ''}</p><p className="text-lg font-bold text-gray-900">{formatPrice(total, tenant.currency)}</p></div>
            <button onClick={handleContinueToInfo} className="min-h-12 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-bold text-white">Continuer</button>
          </div>
        </div>
      )}
    </div>
  );
}
