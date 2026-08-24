'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBuildingStore, IconCheck, IconMapPin, IconTruck } from '@tabler/icons-react';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { CartEmpty } from '@/components/cart/CartEmpty';
import { CartItem } from '@/components/cart/CartItem';
import { CartOrderSummary } from '@/components/cart/CartOrderSummary';
import { CartUndoToast } from '@/components/cart/CartUndoToast';
import { MobileCartStickyCTA } from '@/components/cart/MobileCartStickyCTA';
import { selectCartIsEmpty, selectCartItemCount, selectCartItems, selectCartSubtotal, selectPendingProductIds } from '@/lib/cart/cartSelectors';
import { formatProductCount } from '@/lib/cart/formatProductCount';
import { calculateCartTotal, canProceedToCheckout, shouldShowMobileCartStickyCta } from '@/lib/cart/cartPagePresentation';
import type { CustomerProfile } from '@/lib/customers/types';
import type { FreeShippingInfo } from '@/lib/shipping/freeShippingInfo';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { useCartStore } from '@/stores/cartStore';
import type { CartItem as CartItemType, Tenant } from '@lepefy/types';

const COUNTRIES = [
  { value: 'IT', label: 'Italie' }, { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' }, { value: 'DE', label: 'Allemagne' },
  { value: 'CH', label: 'Suisse' },
];
const UNDO_TIMEOUT_MS = 5000;

function splitLine1(line1: string): { street: string; houseNumber: string } {
  const parts = line1.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { street: line1.trim(), houseNumber: '' };
  const last = parts[parts.length - 1] ?? '';
  if (/\d/.test(last) || /^s\.?\s?n\.?$/i.test(last)) return { street: parts.slice(0, -1).join(' '), houseNumber: last };
  return { street: parts.join(' '), houseNumber: '' };
}

export default function CartClient({ tenant }: { tenant: Tenant }) {
  const items = useCartStore(selectCartItems);
  const itemCount = useCartStore(selectCartItemCount);
  const subtotal = useCartStore(selectCartSubtotal);
  const isEmpty = useCartStore(selectCartIsEmpty);
  const pendingProductIds = useCartStore(selectPendingProductIds);
  const unavailableProductIds = useCartStore((state) => state.unavailableProductIds);
  const syncStatus = useCartStore((state) => state.syncStatus);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const addItem = useCartStore((state) => state.addItem);
  const shippingPayload = useCartStore((state) => state.shippingPayload);
  const router = useRouter();
  const { customer: sessionCustomer } = useSessionCustomer();

  const [fulfillmentType, setFulfillmentType] = useState<'delivery' | 'pickup'>('delivery');
  const [country, setCountry] = useState('IT');
  const [postalCode, setPostalCode] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressHouseNumber, setAddressHouseNumber] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [shippingTotal, setShippingTotal] = useState<number | null>(null);
  const [shippingDetails, setShippingDetails] = useState<Record<string, unknown> | null>(null);
  const [freeShipping, setFreeShipping] = useState<FreeShippingInfo>(null);
  const [quoteToken, setQuoteToken] = useState<string | null>(null);
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [shippingLoading, setShippingLoading] = useState(false);
  const [prefilledAddress, setPrefilledAddress] = useState(false);
  const [undo, setUndo] = useState<{ item: CartItemType; timeoutId: ReturnType<typeof setTimeout> } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefilledForCustomerRef = useRef<string | null>(null);
  const addressSectionRef = useRef<HTMLDivElement>(null);

  const effectiveShipping = fulfillmentType === 'pickup' ? 0 : shippingTotal;
  const total = calculateCartTotal(subtotal, effectiveShipping);
  const canProceed = canProceedToCheckout(itemCount, fulfillmentType, shippingTotal);
  const shippingPayloadKey = JSON.stringify(shippingPayload());
  const deliveryQuoteMissing = fulfillmentType === 'delivery' && shippingTotal === null;

  const fetchShipping = useCallback(async (zip: string, destinationCountry: string) => {
    if (zip.length < 4) return;
    setShippingLoading(true);
    setShippingError(null);
    try {
      const response = await fetch('/api/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: shippingPayload(), to: { country: destinationCountry, zip_code: zip } }),
      });
      const data = await response.json();
      if (data.available) {
        setShippingTotal(data.shippingTotal);
        setShippingDetails(data.shippingDetails ?? null);
        setFreeShipping(data.freeShipping ?? null);
        setQuoteToken(data.quoteToken ?? null);
      } else {
        setShippingError(data.message ?? 'Livraison non disponible pour cette adresse.');
        setShippingTotal(null);
        setShippingDetails(null);
        setFreeShipping(null);
        setQuoteToken(null);
      }
    } catch {
      setShippingError('Erreur lors du calcul des frais de livraison.');
      setShippingTotal(null);
      setShippingDetails(null);
      setFreeShipping(null);
      setQuoteToken(null);
    } finally {
      setShippingLoading(false);
    }
  }, [shippingPayload]);

  function invalidateShippingQuote() {
    setShippingTotal(null);
    setShippingDetails(null);
    setFreeShipping(null);
    setQuoteToken(null);
    setShippingError(null);
  }

  useEffect(() => {
    if (fulfillmentType === 'pickup') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchShipping(postalCode, country), 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [postalCode, country, fulfillmentType, fetchShipping]);

  useEffect(() => {
    if (fulfillmentType !== 'delivery' || !sessionCustomer || prefilledForCustomerRef.current === sessionCustomer.id) return;
    prefilledForCustomerRef.current = sessionCustomer.id;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/customers/me');
        if (!response.ok || cancelled) return;
        const profile = (await response.json()) as CustomerProfile;
        const address = profile.defaultAddress;
        if (!address || postalCode.trim() !== '') return;
        const line = splitLine1(address.line1);
        if (COUNTRIES.some((entry) => entry.value === address.country)) setCountry(address.country);
        setPostalCode(address.postalCode);
        if (addressStreet.trim() === '') setAddressStreet(line.street);
        if (addressHouseNumber.trim() === '') setAddressHouseNumber(line.houseNumber);
        if (addressCity.trim() === '') setAddressCity(address.city);
        setManualMode(true);
        setPrefilledAddress(true);
      } catch {
        // Optional profile prefill.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCustomer, fulfillmentType]);

  useEffect(() => {
    if (fulfillmentType === 'pickup' || postalCode.length < 4) return;
    if (shippingTotal === 0 && freeShipping !== null && freeShipping.reason !== 'threshold') return;
    setShippingTotal(null);
    setShippingDetails(null);
    setFreeShipping(null);
    setQuoteToken(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchShipping(postalCode, country), 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingPayloadKey]);

  useEffect(() => () => { if (undo) clearTimeout(undo.timeoutId); }, [undo]);

  function handleIncrement(productId: string) {
    const item = items.find((entry) => entry.product.id === productId);
    if (item) updateQuantity(productId, Math.min(item.quantity + 1, item.product.stock));
  }

  function handleDecrement(productId: string) {
    const item = items.find((entry) => entry.product.id === productId);
    if (item) updateQuantity(productId, item.quantity - 1);
  }

  function handleRemove(productId: string) {
    const item = items.find((entry) => entry.product.id === productId);
    if (!item) return;
    if (undo) clearTimeout(undo.timeoutId);
    removeItem(productId);
    setUndo({ item, timeoutId: setTimeout(() => setUndo(null), UNDO_TIMEOUT_MS) });
  }

  function handleUndo() {
    if (!undo) return;
    clearTimeout(undo.timeoutId);
    addItem(undo.item.product, undo.item.quantity);
    setUndo(null);
  }

  function handleProceed() {
    sessionStorage.setItem('lepefy-checkout-shipping', JSON.stringify({
      shippingTotal: fulfillmentType === 'pickup' ? 0 : shippingTotal,
      shippingDetails: fulfillmentType === 'pickup' ? null : shippingDetails,
      freeShipping: fulfillmentType === 'pickup' ? null : freeShipping,
      quoteToken: fulfillmentType === 'pickup' ? null : quoteToken,
      fulfillmentType,
      country: fulfillmentType === 'delivery' ? country : null,
      postalCode: fulfillmentType === 'delivery' ? postalCode : null,
      street: fulfillmentType === 'delivery' ? addressStreet : null,
      houseNumber: fulfillmentType === 'delivery' ? addressHouseNumber : null,
      city: fulfillmentType === 'delivery' ? addressCity : null,
    }));
    router.push('/checkout');
  }

  function focusAddressSection() {
    const section = addressSectionRef.current;
    if (!section) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    window.setTimeout(() => {
      const target = section.querySelector<HTMLInputElement>('input') ?? section.querySelector<HTMLSelectElement>('select');
      target?.focus();
    }, reduceMotion ? 0 : 350);
  }

  function handlePrimaryAction() {
    if (canProceed) {
      handleProceed();
      return;
    }
    if (fulfillmentType === 'delivery') focusAddressSection();
  }

  if (isEmpty) return <div className="flex min-h-[60vh]"><CartEmpty headingLevel="h1" /></div>;

  const primaryActionLabel = canProceed
    ? 'Continuer vers le paiement'
    : shippingLoading
      ? 'Calcul de la livraison…'
      : shippingError
        ? 'Modifier mon adresse'
        : 'Indiquer mon adresse';

  const primaryActionHint = deliveryQuoteMissing
    ? shippingError
      ? 'Vérifiez votre adresse pour recalculer la livraison.'
      : 'Adresse requise : elle sert à calculer vos frais de livraison avant le paiement.'
    : null;

  const shippingControls = (
    <div className="space-y-4">
      {tenant.click_collect_enabled && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-gray-800">Mode de récupération</legend>
          <div className="grid grid-cols-2 gap-2.5">
            {(['delivery', 'pickup'] as const).map((type) => {
              const active = fulfillmentType === type;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFulfillmentType(type)}
                  className={`relative flex min-h-[66px] items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${active ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_5%,white)] text-gray-950' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-100 text-gray-500'}`}>
                    {type === 'delivery' ? <IconTruck size={18} aria-hidden="true" /> : <IconBuildingStore size={18} aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{type === 'delivery' ? 'Livraison' : 'Click & Collect'}</span>
                    <span className="mt-0.5 hidden text-[11px] leading-tight text-gray-500 xl:block">{type === 'delivery' ? 'À votre adresse' : 'Retrait en boutique'}</span>
                  </span>
                  {active && <IconCheck size={15} aria-hidden="true" className="absolute right-2.5 top-2.5 text-[var(--color-primary)]" />}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {fulfillmentType === 'pickup' && tenant.click_collect_address && (
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
          <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-gray-900"><IconMapPin size={16} aria-hidden="true" /> Adresse de retrait</p>
          <p className="leading-relaxed text-gray-600">{tenant.click_collect_address}</p>
          <p className="mt-2 text-xs font-medium text-green-700">Aucun frais de livraison.</p>
        </div>
      )}

      {fulfillmentType === 'delivery' && (
        <div
          ref={addressSectionRef}
          className={`rounded-2xl border p-4 transition-colors ${deliveryQuoteMissing ? 'border-amber-200 bg-amber-50/55' : 'border-green-100 bg-green-50/35'}`}
        >
          <div className="mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">Adresse de livraison</p>
              {deliveryQuoteMissing && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-amber-800">Requise</span>}
            </div>
            <p className="mt-1 text-xs font-medium leading-relaxed text-gray-600">Nous en avons besoin maintenant uniquement pour calculer vos frais de livraison.</p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-[125px_minmax(0,1fr)] lg:grid-cols-1 xl:grid-cols-[125px_minmax(0,1fr)]">
            <select
              aria-label="Pays de livraison"
              value={country}
              onChange={(event) => {
                invalidateShippingQuote();
                setCountry(event.target.value);
              }}
              className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              {COUNTRIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
            {manualMode ? (
              <input
                aria-label="Code postal"
                type="text"
                inputMode="numeric"
                placeholder="Code postal"
                value={postalCode}
                onChange={(event) => {
                  invalidateShippingQuote();
                  setPostalCode(event.target.value);
                }}
                maxLength={10}
                className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            ) : (
              <AddressAutocomplete
                country={country}
                placeholder="Rue et numéro, ville"
                onSelect={(result) => {
                  invalidateShippingQuote();
                  setPostalCode(result.postalCode);
                  setAddressStreet(result.street);
                  setAddressHouseNumber(result.houseNumber);
                  setAddressCity(result.city);
                }}
                onManualFallback={() => {
                  invalidateShippingQuote();
                  setManualMode(true);
                  setAddressStreet('');
                  setAddressHouseNumber('');
                  setAddressCity('');
                }}
              />
            )}
          </div>
          {prefilledAddress && <p className="mt-2 text-xs text-gray-500">Votre adresse habituelle a été préremplie — vous pouvez la modifier.</p>}
          {shippingLoading && <p className="mt-2 text-xs font-medium text-gray-600" role="status">Calcul de la livraison…</p>}
          {!shippingLoading && shippingError && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700" role="alert">{shippingError}</p>}
          {!shippingLoading && shippingTotal !== null && !shippingError && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-green-700"><span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" /> Livraison calculée. Votre total est maintenant définitif.</p>
          )}
          {!shippingLoading && freeShipping && <p className="mt-1.5 text-sm font-medium text-green-700">Livraison offerte{freeShipping.reason === 'threshold' ? ' pour cette commande' : ' pour ce pays'}.</p>}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 pb-56 sm:px-6 sm:py-7 md:pb-10 lg:px-8 lg:py-8">
      <nav aria-label="Fil d’Ariane" className="mb-3 text-xs font-medium text-gray-400 sm:text-sm">
        <a href="/products" className="transition-colors hover:text-gray-800">Catalogue</a>
        <span aria-hidden="true" className="px-1.5">/</span>
        <span aria-current="page" className="text-gray-600">Panier</span>
      </nav>

      <header className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950 sm:text-[34px]">Votre panier</h1>
          <p className="mt-1 text-sm text-gray-500" aria-live="polite">{formatProductCount(itemCount)}</p>
        </div>
        <a href="/products" className="hidden min-h-10 items-center text-sm font-semibold text-gray-500 transition-colors hover:text-gray-900 sm:flex">
          Continuer mes achats
        </a>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:gap-8">
        <section aria-labelledby="cart-items-title" className="min-w-0">
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <h2 id="cart-items-title" className="text-sm font-bold text-gray-900">Articles</h2>
              <p className="mt-0.5 text-xs text-gray-500">Vérifiez chaque article avant de choisir la livraison.</p>
            </div>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">{formatProductCount(itemCount)}</span>
          </div>
          <ul className="space-y-3">{items.map((item) => <CartItem key={item.product.id} item={item} variant="page" currency={tenant.currency} unavailableProductIds={unavailableProductIds} pendingProductIds={pendingProductIds} onIncrement={handleIncrement} onDecrement={handleDecrement} onRemove={handleRemove} />)}</ul>
          {undo && <div className="pt-3"><CartUndoToast productName={undo.item.product.name} onUndo={handleUndo} /></div>}
        </section>

        <aside className="lg:sticky lg:top-6">
          <CartOrderSummary
            subtotal={subtotal}
            shippingCost={effectiveShipping}
            total={total}
            currency={tenant.currency}
            canProceed={canProceed}
            checkoutHint={primaryActionHint}
            primaryActionLabel={primaryActionLabel}
            primaryActionDisabled={shippingLoading}
            syncStatus={syncStatus}
            onCheckout={handlePrimaryAction}
            hideActionsOnMobile
          >
            {shippingControls}
          </CartOrderSummary>
        </aside>
      </div>

      {shouldShowMobileCartStickyCta(itemCount) && (
        <MobileCartStickyCTA
          total={total}
          currency={tenant.currency}
          totalIsEstimated={deliveryQuoteMissing}
          label={primaryActionLabel}
          hint={primaryActionHint}
          disabled={shippingLoading}
          onCheckout={handlePrimaryAction}
        />
      )}
    </div>
  );
}
