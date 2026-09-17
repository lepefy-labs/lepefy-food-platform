'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCreditCard, IconMinus, IconPlus, IconSearch, IconShoppingBag, IconTruckDelivery, IconBuildingStore } from '@tabler/icons-react';
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
import type { RentalItem, TenantPaymentMethod } from '@lepefy/types';

interface Props {
  service: { id: string; slug: string; title: string };
  rentalItems: RentalItem[];
  tenant: { currency: string };
  externalPaymentMethods?: TenantPaymentMethod[];
}

export default function RentalCheckoutClient({ service, rentalItems, tenant, externalPaymentMethods = [] }: Props) {
  const router = useRouter();
  const { customer: sessionCustomer } = useSessionCustomer();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [pickupDate, setPickupDate] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'select' | 'choose-payment' | 'payment'>('select');
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [selectedExternalMethodId, setSelectedExternalMethodId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const [fulfillmentType, setFulfillmentType] = useState<'pickup' | 'delivery'>('pickup');
  const [street, setStreet] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');
  const [deliveryQuote, setDeliveryQuote] = useState<{
    status: 'idle' | 'loading' | 'quoted' | 'pending_quote' | 'unavailable';
    feeAmount: number | null;
    reason?: 'country_not_allowed' | 'delivery_disabled';
  }>({ status: 'idle', feeAmount: null });

  usePaymentRedirectRecovery('rental', () => {
    router.push(`${window.location.pathname}/confirmation`);
  });

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
        // Prefill is optional: guest checkout remains available.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCustomer]);

  const categories = useMemo(
    () => [...new Set(rentalItems.map((item) => item.category).filter((c): c is string => Boolean(c)))],
    [rentalItems],
  );

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rentalItems.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (query && !item.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [rentalItems, selectedCategory, searchQuery]);

  // Devis d'affichage uniquement — l'aperçu du supplément pendant que le
  // client remplit son adresse. Le montant réel est recalculé côté serveur
  // (voir matchDeliveryZone.ts) au moment du paiement, jamais fait confiance
  // à cette valeur.
  useEffect(() => {
    if (fulfillmentType !== 'delivery' || !country.trim() || !postalCode.trim() || !city.trim()) {
      setDeliveryQuote({ status: 'idle', feeAmount: null });
      return;
    }
    setDeliveryQuote((previous) => ({ ...previous, status: 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/rental/delivery-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service_offering_id: service.id, country, postal_code: postalCode, city }),
        });
        const result = await res.json();
        if (!result.available) {
          setDeliveryQuote({ status: 'unavailable', feeAmount: null, reason: result.reason });
        } else if (result.zoneMatched) {
          setDeliveryQuote({ status: 'quoted', feeAmount: result.feeAmount });
        } else {
          setDeliveryQuote({ status: 'pending_quote', feeAmount: null });
        }
      } catch {
        setDeliveryQuote({ status: 'idle', feeAmount: null });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [fulfillmentType, country, postalCode, city, service.id]);

  const totalQuantity = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const itemsTotal = rentalItems.reduce((sum, item) => sum + (quantities[item.id] ?? 0) * item.price_per_unit, 0);
  const deliveryFeePreview = deliveryQuote.status === 'quoted' ? deliveryQuote.feeAmount ?? 0 : 0;
  const total = itemsTotal + deliveryFeePreview;
  const selectedItems = rentalItems.filter((item) => (quantities[item.id] ?? 0) > 0);

  function setQuantity(itemId: string, delta: number, max: number) {
    setQuantities((previous) => ({
      ...previous,
      [itemId]: Math.min(max, Math.max(0, (previous[itemId] ?? 0) + delta)),
    }));
  }

  function handleContinueToPayment() {
    setError(null);
    if (totalQuantity === 0) return setError('Sélectionnez au moins un article.');
    if (!pickupDate) return setError('Indiquez une date de retrait.');
    if (!name.trim() || !email.trim()) return setError('Nom et email sont obligatoires.');
    if (fulfillmentType === 'delivery') {
      if (!street.trim() || !houseNumber.trim() || !city.trim() || !postalCode.trim() || !country.trim()) {
        return setError('Renseignez votre adresse de livraison complète.');
      }
      if (deliveryQuote.status === 'unavailable') {
        return setError('Livraison indisponible pour cette adresse — choisissez le retrait en boutique.');
      }
    }
    setStep('choose-payment');
  }

  function deliveryPayload() {
    if (fulfillmentType !== 'delivery') return { fulfillment_type: 'pickup' as const };
    return {
      fulfillment_type: 'delivery' as const,
      street: street.trim(),
      house_number: houseNumber.trim(),
      city: city.trim(),
      postal_code: postalCode.trim(),
      country: country.trim(),
    };
  }

  async function createIntent() {
    const items = selectedItems.map((item) => ({ rental_item_id: item.id, quantity: quantities[item.id] }));
    try {
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
          ...deliveryPayload(),
        }),
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
      const items = selectedItems.map((item) => ({ rental_item_id: item.id, quantity: quantities[item.id] }));
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
            ...deliveryPayload(),
          }),
        });
        const result = await res.json();
        if (!res.ok) {
          setError(result.error ?? 'Une erreur est survenue.');
          return;
        }
        sessionStorage.setItem('lepefy-pending-rental-payment', JSON.stringify({
          requestId: result.requestId,
          link: result.link,
          amount: result.amount,
          currency: result.currency,
          isPaypal: result.isPaypal,
          label: result.label,
        }));
        router.push(`${window.location.pathname}/en-attente?ref=${result.requestId}`);
        return;
      }
      setShowPaymentStep(true);
      setStep('payment');
    } catch {
      setError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass = 'min-h-11 w-full rounded-xl border border-black/10 bg-[#fffdf9] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-primary)_18%,transparent)]';

  if (rentalItems.length === 0) {
    return <div className="rounded-3xl border border-black/[0.06] bg-white p-8 text-center text-sm text-gray-500">Aucun article disponible pour le moment.</div>;
  }

  if (step === 'payment' && showPaymentStep) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
        {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <StripePaymentStep
          module="rental"
          amount={total}
          currency={tenant.currency}
          color="var(--color-primary)"
          returnUrl={`${window.location.origin}/evenementiel`}
          referenceId={service.id}
          payLabel={`Payer ${formatPrice(total, tenant.currency)}`}
          processingLabel="Traitement en cours…"
          billingCountryHint="Si un pays est demandé ci-dessous, indiquez celui associé à votre carte bancaire (facturation), pas votre position actuelle."
          createIntent={createIntent}
          onError={setError}
          onSucceeded={(paymentIntentId) => router.push(`${window.location.pathname}/confirmation?payment_intent=${paymentIntentId ?? ''}`)}
        />
      </div>
    );
  }

  if (step === 'choose-payment') {
    const selectedExternalMethod = externalPaymentMethods.find((method) => method.id === selectedExternalMethodId) ?? null;
    const ctaLabel = selectedExternalMethod ? externalPaymentCtaLabel(selectedExternalMethod, 'la réservation') : 'Continuer vers le paiement';
    const ctaColor = selectedExternalMethod ? externalPaymentCtaColor(selectedExternalMethod) : 'var(--color-primary)';
    const options = [
      {
        key: 'stripe',
        selected: !selectedExternalMethodId,
        onSelect: () => setSelectedExternalMethodId(null),
        icon: <IconCreditCard size={16} stroke={1.8} className="text-white" />,
        color: 'var(--color-primary)',
        label: 'Carte bancaire',
        sub: 'Paiement sécurisé, confirmation immédiate',
      },
      ...buildExternalPaymentOptions(externalPaymentMethods, selectedExternalMethodId, setSelectedExternalMethodId),
    ];

    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <button type="button" onClick={() => { setError(null); setStep('select'); }} disabled={isSubmitting} className="min-h-11 rounded-xl px-2 text-sm font-semibold text-gray-600 hover:text-gray-900">← Retour à la sélection</button>
        <div className="rounded-3xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-4 border-b border-black/[0.06] pb-4">
            <div><p className="text-xs text-gray-500">Votre sélection</p><p className="font-semibold text-gray-900">{totalQuantity} article{totalQuantity > 1 ? 's' : ''}</p></div>
            <p className="text-xl font-bold text-gray-900">{formatPrice(total, tenant.currency)}</p>
          </div>
          <p className="mb-3 text-sm font-semibold text-gray-800">Méthode de paiement</p>
          <PaymentOptionList options={options} />
          {selectedExternalMethod && <ExternalPaymentNote method={selectedExternalMethod} total={total} currency={tenant.currency} />}
        </div>
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <button onClick={handleConfirmPayment} disabled={isSubmitting} className="min-h-12 w-full rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: ctaColor }}>
          {isSubmitting ? 'Traitement…' : selectedExternalMethod ? `${ctaLabel} — ${formatPrice(total, tenant.currency)}` : ctaLabel}
        </button>
      </div>
    );
  }

  const basket = (
    <div className="rounded-3xl border border-black/[0.06] bg-white p-5 shadow-[0_14px_35px_rgba(50,37,20,.08)]">
      <div className="flex items-center gap-2">
        <IconShoppingBag size={20} className="text-[var(--color-primary)]" />
        <h2 className="font-display text-xl font-semibold">Votre sélection</h2>
      </div>
      {selectedItems.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">Ajoutez du matériel pour préparer votre réservation.</p>
      ) : (
        <div className="mt-4 divide-y divide-black/[0.06]">
          {selectedItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0 truncate">{item.name} × {quantities[item.id]}</span>
              <span className="shrink-0 font-semibold">{formatPrice(item.price_per_unit * (quantities[item.id] ?? 0), tenant.currency)}</span>
            </div>
          ))}
          {fulfillmentType === 'delivery' && deliveryQuote.status === 'quoted' && (
            <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0 truncate">Livraison</span>
              <span className="shrink-0 font-semibold">{formatPrice(deliveryQuote.feeAmount ?? 0, tenant.currency)}</span>
            </div>
          )}
          {fulfillmentType === 'delivery' && deliveryQuote.status === 'pending_quote' && (
            <div className="flex items-center justify-between gap-3 py-2.5 text-sm text-gray-500">
              <span className="min-w-0 truncate">Livraison</span>
              <span className="shrink-0 text-xs">Supplément à confirmer</span>
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between border-t border-black/[0.08] pt-4">
        <span className="text-sm font-semibold">Total</span>
        <span className="text-xl font-bold">{formatPrice(total, tenant.currency)}</span>
      </div>
    </div>
  );

  return (
    <div className="pb-[108px] lg:pb-0">
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div>
          {(categories.length > 1 || rentalItems.length > 6) && (
            <div className="mb-4 space-y-3">
              <div className="relative">
                <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un article…"
                  className="min-h-11 w-full rounded-xl border border-black/10 bg-white py-2.5 pl-10 pr-3.5 text-sm outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              {categories.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setSelectedCategory('all')} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${selectedCategory === 'all' ? 'bg-[var(--color-primary)] text-white' : 'bg-white text-gray-600 border border-black/10'}`}>Tous</button>
                  {categories.map((cat) => (
                    <button key={cat} type="button" onClick={() => setSelectedCategory(cat)} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${selectedCategory === cat ? 'bg-[var(--color-primary)] text-white' : 'bg-white text-gray-600 border border-black/10'}`}>{cat}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {filteredItems.length === 0 ? (
            <p className="rounded-3xl border border-black/[0.06] bg-white p-8 text-center text-sm text-gray-500">Aucun article ne correspond à votre recherche.</p>
          ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => {
              const quantity = quantities[item.id] ?? 0;
              const soldOut = item.stock_quantity <= 0;
              return (
                <article key={item.id} className="overflow-hidden rounded-3xl border border-black/[0.06] bg-white shadow-sm">
                  <div className="aspect-[4/3] bg-[#eee8dc]">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image_url} alt={item.name} className="h-full w-full bg-white object-contain p-4" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-gray-400">Photo indisponible</div>
                    )}
                  </div>
                  <div className="p-4">
                    {item.category && <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-primary)]">{item.category}</p>}
                    <h2 className="mt-1 font-display text-xl font-semibold leading-tight">{item.name}</h2>
                    <p className="mt-2 text-sm font-bold text-gray-900">{formatPrice(item.price_per_unit, tenant.currency)} <span className="text-xs font-normal text-gray-500">/ unité</span></p>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className={`text-xs ${soldOut ? 'font-semibold text-red-600' : 'text-gray-500'}`}>{soldOut ? 'Indisponible' : `${item.stock_quantity} disponible${item.stock_quantity > 1 ? 's' : ''}`}</span>
                      <div className="flex items-center gap-2" aria-label={`Quantité pour ${item.name}`}>
                        <button type="button" aria-label={`Retirer un ${item.name}`} onClick={() => setQuantity(item.id, -1, item.stock_quantity)} disabled={quantity === 0} className="flex size-11 items-center justify-center rounded-xl border border-black/10 text-gray-700 disabled:opacity-35"><IconMinus size={16} /></button>
                        <span className="w-6 text-center text-sm font-bold">{quantity}</span>
                        <button type="button" aria-label={`Ajouter un ${item.name}`} onClick={() => setQuantity(item.id, 1, item.stock_quantity)} disabled={soldOut || quantity >= item.stock_quantity} className="flex size-11 items-center justify-center rounded-xl border border-black/10 text-gray-700 disabled:opacity-35"><IconPlus size={16} /></button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          )}

          <section className="mt-7 rounded-3xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-display text-2xl font-semibold">Retrait et coordonnées</h2>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFulfillmentType('pickup')}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold ${fulfillmentType === 'pickup' ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]' : 'border-black/10 text-gray-600'}`}
              >
                <IconBuildingStore size={16} /> Retrait en boutique
              </button>
              <button
                type="button"
                onClick={() => setFulfillmentType('delivery')}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold ${fulfillmentType === 'delivery' ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]' : 'border-black/10 text-gray-600'}`}
              >
                <IconTruckDelivery size={16} /> Livraison
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-gray-600 sm:col-span-2">Date de retrait souhaitée<input value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} type="date" className={`${inputClass} mt-1.5`} /></label>
              <label className="text-xs font-medium text-gray-600">Nom complet<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={`${inputClass} mt-1.5`} /></label>
              <label className="text-xs font-medium text-gray-600">Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" className={`${inputClass} mt-1.5`} /></label>
              <label className="text-xs font-medium text-gray-600 sm:col-span-2">Téléphone<input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" className={`${inputClass} mt-1.5`} /></label>

              {fulfillmentType === 'delivery' && (
                <>
                  <label className="text-xs font-medium text-gray-600">Rue<input value={street} onChange={(e) => setStreet(e.target.value)} className={`${inputClass} mt-1.5`} /></label>
                  <label className="text-xs font-medium text-gray-600">Numéro<input value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} className={`${inputClass} mt-1.5`} /></label>
                  <label className="text-xs font-medium text-gray-600">Code postal<input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className={`${inputClass} mt-1.5`} /></label>
                  <label className="text-xs font-medium text-gray-600">Ville<input value={city} onChange={(e) => setCity(e.target.value)} className={`${inputClass} mt-1.5`} /></label>
                  <label className="text-xs font-medium text-gray-600 sm:col-span-2">Pays<input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Ex. IT, FR" className={`${inputClass} mt-1.5`} /></label>

                  <div className="sm:col-span-2">
                    {deliveryQuote.status === 'loading' && <p className="text-xs text-gray-500">Vérification de la disponibilité…</p>}
                    {deliveryQuote.status === 'quoted' && (
                      <p className="rounded-xl bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--color-primary)]">
                        Supplément de livraison : {formatPrice(deliveryQuote.feeAmount ?? 0, tenant.currency)} — inclus dans le total.
                      </p>
                    )}
                    {deliveryQuote.status === 'pending_quote' && (
                      <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Aucun supplément n&apos;est facturé maintenant. Il sera confirmé par l&apos;établissement selon votre localisation et payé séparément.
                      </p>
                    )}
                    {deliveryQuote.status === 'unavailable' && (
                      <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                        Livraison indisponible pour cette adresse — choisissez le retrait en boutique.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
          <button onClick={handleContinueToPayment} disabled={totalQuantity === 0} className="mt-5 hidden min-h-12 w-full rounded-xl bg-[var(--color-primary)] px-5 py-3 text-sm font-bold text-white disabled:opacity-50 lg:block">Continuer vers le paiement</button>
        </div>

        <aside className="sticky top-[92px] hidden lg:block">
          {basket}
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_rgba(0,0,0,.08)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[620px] items-center gap-3">
          <div className="min-w-0 flex-1"><p className="text-xs text-gray-500">{totalQuantity} article{totalQuantity > 1 ? 's' : ''}</p><p className="text-lg font-bold text-gray-900">{formatPrice(total, tenant.currency)}</p></div>
          <button onClick={handleContinueToPayment} disabled={totalQuantity === 0} className="min-h-12 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-bold text-white disabled:opacity-50">Voir le panier</button>
        </div>
      </div>
    </div>
  );
}
