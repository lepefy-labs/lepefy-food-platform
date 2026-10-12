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
import { CustomerAddressForm, addressFieldId } from '@/components/address/CustomerAddressForm';
import { ErrorSummary, TextField } from '@/components/ui/form';
import {
  ADDRESS_FIELD_LABELS,
  ADDRESS_FIELD_ORDER,
  countryOptions,
  emptyAddressDraft,
  isValidPostalCode,
  normalizePostalCode,
  validateAddressDraft,
  type AddressDraft,
} from '@/lib/address/addressRules';
import { ADDRESS_COPY } from '@/lib/storefrontCopy/addressCopy';
import { FORM_COPY } from '@/lib/storefrontCopy/copy';
import type { RentalItem, TenantPaymentMethod } from '@lepefy/types';

const ADDRESS_ID_PREFIX = 'location-adresse';

interface Props {
  service: { id: string; slug: string; title: string };
  rentalItems: RentalItem[];
  /** Projection explicite : devise et livraison du matériel (rental_delivery_*). */
  tenant: { currency: string; deliveryEnabled: boolean; deliveryCountries: string[] };
  externalPaymentMethods?: TenantPaymentMethod[];
}

type ContactErrors = { pickupDate?: string; name?: string; email?: string };

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

  // La livraison n'est proposée que si le tenant livre vers au moins un pays.
  const deliveryCountries = useMemo(() => countryOptions(tenant.deliveryCountries).map((option) => option.code), [tenant.deliveryCountries]);
  const canDeliver = tenant.deliveryEnabled && deliveryCountries.length > 0;
  const [fulfillmentType, setFulfillmentType] = useState<'pickup' | 'delivery'>('pickup');
  const [address, setAddress] = useState<AddressDraft>(() => emptyAddressDraft(deliveryCountries[0] ?? 'IT'));
  const [addressSubmitted, setAddressSubmitted] = useState(false);
  const [contactErrors, setContactErrors] = useState<ContactErrors>({});
  const addressSummaryRef = useRef<HTMLDivElement>(null);
  const quotePostalCode = normalizePostalCode(address.country, address.postalCode);
  const quoteCity = address.city.trim();
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
    // Aperçu seulement avec un code postal complet et une ville (zones par CP ou par ville).
    if (fulfillmentType !== 'delivery' || !isValidPostalCode(address.country, quotePostalCode) || !quoteCity) {
      setDeliveryQuote({ status: 'idle', feeAmount: null });
      return;
    }
    setDeliveryQuote((previous) => ({ ...previous, status: 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/rental/delivery-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service_offering_id: service.id, country: address.country, postal_code: quotePostalCode, city: quoteCity }),
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
  }, [fulfillmentType, address.country, quotePostalCode, quoteCity, service.id]);

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

  const addressErrors = validateAddressDraft(address, { allowedCountries: deliveryCountries });
  const addressSummaryItems = addressSubmitted && fulfillmentType === 'delivery'
    ? ADDRESS_FIELD_ORDER.filter((field) => addressErrors[field])
      .map((field) => ({ fieldId: addressFieldId(ADDRESS_ID_PREFIX, field), label: ADDRESS_FIELD_LABELS[field] }))
    : [];

  function focusField(id: string) {
    window.setTimeout(() => {
      const target = id === 'address-summary' ? addressSummaryRef.current : document.getElementById(id);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    }, 60);
  }

  function handleContinueToPayment() {
    setError(null);
    if (totalQuantity === 0) return setError('Choisissez au moins un article.');
    const nextContact: ContactErrors = {};
    if (!pickupDate) nextContact.pickupDate = fulfillmentType === 'delivery' ? 'Choisissez la date de livraison.' : 'Choisissez la date de retrait.';
    if (!name.trim()) nextContact.name = ADDRESS_COPY.required;
    if (!email.trim()) nextContact.email = ADDRESS_COPY.required;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nextContact.email = FORM_COPY.emailInvalid;
    setContactErrors(nextContact);
    if (fulfillmentType === 'delivery' && Object.keys(addressErrors).length > 0) {
      setAddressSubmitted(true);
      focusField('address-summary');
      return;
    }
    if (nextContact.pickupDate) return focusField('location-date');
    if (nextContact.name) return focusField('location-name');
    if (nextContact.email) return focusField('location-email');
    if (fulfillmentType === 'delivery' && deliveryQuote.status === 'unavailable') {
      return setError('Nous ne livrons pas à cette adresse. Vérifiez le code postal, ou choisissez le retrait en boutique.');
    }
    setStep('choose-payment');
  }

  function deliveryPayload() {
    if (fulfillmentType !== 'delivery') return { fulfillment_type: 'pickup' as const };
    return {
      fulfillment_type: 'delivery' as const,
      street: address.street.trim(),
      house_number: address.houseNumber.trim(),
      city: quoteCity,
      postal_code: quotePostalCode,
      country: address.country,
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
                <IconSearch size={18} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un article…"
                  aria-label="Rechercher un article"
                  className="sf-control sf-control--md sf-control--leading"
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
                    {item.category && <p className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-primary-dark)]">{item.category}</p>}
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
            <h2 className="font-display text-2xl font-semibold">{canDeliver ? 'Retrait ou livraison' : 'Retrait et coordonnées'}</h2>

            {canDeliver ? (
              <div className="mt-5 grid grid-cols-2 gap-2" role="group" aria-label="Retrait ou livraison">
                {(['pickup', 'delivery'] as const).map((type) => {
                  const active = fulfillmentType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFulfillmentType(type)}
                      className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border-[1.5px] px-3 text-sm font-semibold ${active ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,white)] text-[color:var(--color-primary-dark)]' : 'border-[color:var(--field-border)] bg-white text-gray-800'}`}
                    >
                      {type === 'pickup' ? <IconBuildingStore size={17} aria-hidden="true" /> : <IconTruckDelivery size={17} aria-hidden="true" />}
                      {type === 'pickup' ? 'Retrait en boutique' : 'Livraison'}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-700">Retrait en boutique uniquement.</p>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <TextField
                id="location-date"
                className="sm:col-span-2"
                label={fulfillmentType === 'delivery' ? 'Date de livraison souhaitée' : 'Date de retrait souhaitée'}
                type="date"
                value={pickupDate}
                error={contactErrors.pickupDate}
                onChange={(e) => setPickupDate(e.target.value)}
              />
              <TextField id="location-name" label="Nom et prénom" autoComplete="name" placeholder="Ex. : Marie Kamga" value={name} error={contactErrors.name} onChange={(e) => setName(e.target.value)} />
              <TextField id="location-email" label="E-mail" type="email" inputMode="email" autoComplete="email" placeholder="Ex. : nom@gmail.com" value={email} error={contactErrors.email} onChange={(e) => setEmail(e.target.value)} />
              <TextField id="location-phone" className="sm:col-span-2" label="Téléphone" optional type="tel" inputMode="tel" autoComplete="tel" placeholder="Ex. : +39 351 234 5678" hint="Avec l'indicatif du pays." value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>

            {canDeliver && fulfillmentType === 'delivery' && (
              <div className="mt-6 flex flex-col gap-4 border-t border-black/[0.06] pt-5">
                <h3 className="font-display text-lg font-semibold text-gray-950">Où doit-on livrer le matériel ?</h3>
                <ErrorSummary ref={addressSummaryRef} items={addressSummaryItems} />
                <CustomerAddressForm
                  idPrefix={ADDRESS_ID_PREFIX}
                  value={address}
                  onChange={(next) => setAddress(next)}
                  showAllErrors={addressSubmitted}
                  countries={deliveryCountries}
                  countryHint={`Livraison possible : ${countryOptions(deliveryCountries).map((option) => option.label).join(', ')}.`}
                  showLine2={false}
                  autofillSection="shipping"
                />

                <div aria-live="polite">
                  {deliveryQuote.status === 'loading' && (
                    <p className="rounded-xl border border-gray-200 bg-gray-100 px-3.5 py-2.5 text-sm font-semibold text-gray-800" role="status">Nous vérifions la livraison à cette adresse…</p>
                  )}
                  {deliveryQuote.status === 'quoted' && (
                    <p className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-900">
                      <span className="font-bold">Supplément de livraison : {formatPrice(deliveryQuote.feeAmount ?? 0, tenant.currency)}</span>, inclus dans le total.
                    </p>
                  )}
                  {deliveryQuote.status === 'pending_quote' && (
                    <p className="rounded-xl border border-gray-200 bg-gray-100 px-3.5 py-2.5 text-sm text-gray-800">
                      Nous livrons dans ce pays. Le prix de livraison pour cette adresse sera confirmé par l&apos;établissement et payé à part.
                    </p>
                  )}
                  {deliveryQuote.status === 'unavailable' && (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800" role="alert">
                      Nous ne livrons pas à cette adresse. Vérifiez le code postal, ou choisissez le retrait en boutique.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800" role="alert">{error}</p>}
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
