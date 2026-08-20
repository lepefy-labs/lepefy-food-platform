'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBuildingStore, IconMapPin, IconTruck } from '@tabler/icons-react';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { CartEmpty } from '@/components/cart/CartEmpty';
import { CartItem } from '@/components/cart/CartItem';
import { CartOrderSummary } from '@/components/cart/CartOrderSummary';
import { CartUndoToast } from '@/components/cart/CartUndoToast';
import { selectCartIsEmpty, selectCartItemCount, selectCartItems, selectCartSubtotal, selectPendingProductIds } from '@/lib/cart/cartSelectors';
import { formatProductCount } from '@/lib/cart/formatProductCount';
import { calculateCartTotal, canProceedToCheckout } from '@/lib/cart/cartPagePresentation';
import type { CustomerProfile } from '@/lib/customers/types';
import type { FreeShippingInfo } from '@/lib/shipping/freeShippingInfo';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { useCartStore } from '@/stores/cartStore';
import { formatPrice } from '@/lib/utils/format';
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

  const effectiveShipping = fulfillmentType === 'pickup' ? 0 : shippingTotal;
  const total = calculateCartTotal(subtotal, effectiveShipping);
  const canProceed = canProceedToCheckout(itemCount, fulfillmentType, shippingTotal);
  const shippingPayloadKey = JSON.stringify(shippingPayload());

  const fetchShipping = useCallback(async (zip: string, destinationCountry: string) => {
    if (zip.length < 4) return;
    setShippingLoading(true); setShippingError(null);
    try {
      const response = await fetch('/api/shipping/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: shippingPayload(), to: { country: destinationCountry, zip_code: zip } }),
      });
      const data = await response.json();
      if (data.available) {
        setShippingTotal(data.shippingTotal); setShippingDetails(data.shippingDetails ?? null);
        setFreeShipping(data.freeShipping ?? null); setQuoteToken(data.quoteToken ?? null);
      } else {
        setShippingError(data.message ?? 'Livraison non disponible pour cette adresse.');
        setShippingTotal(null); setShippingDetails(null); setFreeShipping(null); setQuoteToken(null);
      }
    } catch {
      setShippingError('Erreur lors du calcul des frais de livraison.');
      setShippingTotal(null); setShippingDetails(null); setFreeShipping(null); setQuoteToken(null);
    } finally { setShippingLoading(false); }
  }, [shippingPayload]);

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
        setManualMode(true); setPrefilledAddress(true);
      } catch { /* Optional profile prefill. */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCustomer, fulfillmentType]);

  useEffect(() => {
    if (fulfillmentType === 'pickup' || postalCode.length < 4) return;
    if (shippingTotal === 0 && freeShipping !== null && freeShipping.reason !== 'threshold') return;
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
    clearTimeout(undo.timeoutId); addItem(undo.item.product, undo.item.quantity); setUndo(null);
  }
  function handleProceed() {
    sessionStorage.setItem('lepefy-checkout-shipping', JSON.stringify({
      shippingTotal: fulfillmentType === 'pickup' ? 0 : shippingTotal,
      shippingDetails: fulfillmentType === 'pickup' ? null : shippingDetails,
      freeShipping: fulfillmentType === 'pickup' ? null : freeShipping,
      quoteToken: fulfillmentType === 'pickup' ? null : quoteToken,
      fulfillmentType, country: fulfillmentType === 'delivery' ? country : null,
      postalCode: fulfillmentType === 'delivery' ? postalCode : null,
      street: fulfillmentType === 'delivery' ? addressStreet : null,
      houseNumber: fulfillmentType === 'delivery' ? addressHouseNumber : null,
      city: fulfillmentType === 'delivery' ? addressCity : null,
    }));
    router.push('/checkout');
  }

  if (isEmpty) return <div className="min-h-[60vh] flex"><CartEmpty headingLevel="h1" /></div>;

  const shippingControls = (
    <div className="space-y-4">
      {tenant.click_collect_enabled && (
        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-gray-700">Mode de récupération</legend>
          <div className="grid grid-cols-2 gap-3">
            {(['delivery', 'pickup'] as const).map((type) => (
              <button key={type} type="button" aria-pressed={fulfillmentType === type} onClick={() => setFulfillmentType(type)} className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${fulfillmentType === type ? 'border-[var(--color-primary)] bg-gray-50 text-[var(--color-primary)]' : 'border-gray-200 text-gray-600'}`}>
                {type === 'delivery' ? <IconTruck size={18} aria-hidden="true" /> : <IconBuildingStore size={18} aria-hidden="true" />}
                {type === 'delivery' ? 'Livraison' : 'Click & Collect'}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {fulfillmentType === 'pickup' && tenant.click_collect_address && (
        <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-700">
          <p className="mb-1 flex items-center gap-1.5 font-semibold"><IconMapPin size={16} aria-hidden="true" /> Adresse de retrait</p><p>{tenant.click_collect_address}</p>
        </div>
      )}
      {fulfillmentType === 'delivery' && (
        <div>
          <p className="mb-3 text-sm font-semibold text-gray-700">Calculer la livraison</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <select aria-label="Pays de livraison" value={country} onChange={(event) => setCountry(event.target.value)} className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]">
              {COUNTRIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
            {manualMode ? <input aria-label="Code postal" type="text" inputMode="numeric" placeholder="Code postal" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} maxLength={10} className="min-w-0 rounded-xl border border-gray-200 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" /> : <AddressAutocomplete country={country} placeholder="Rue et numéro, ville" onSelect={(result) => { setPostalCode(result.postalCode); setAddressStreet(result.street); setAddressHouseNumber(result.houseNumber); setAddressCity(result.city); }} onManualFallback={() => { setManualMode(true); setAddressStreet(''); setAddressHouseNumber(''); setAddressCity(''); }} />}
          </div>
          {prefilledAddress && <p className="mt-2 text-xs text-gray-500">Votre adresse habituelle — vous pouvez la modifier.</p>}
          {shippingLoading && <p className="mt-2 text-xs text-gray-500" role="status">Calcul en cours…</p>}
          {!shippingLoading && shippingError && <p className="mt-2 text-xs text-red-600" role="alert">{shippingError}</p>}
          {!shippingLoading && freeShipping && <p className="mt-2 text-sm font-medium text-green-700">Livraison offerte{freeShipping.reason === 'threshold' ? ' pour cette commande' : ' pour ce pays'}.</p>}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 pb-28 sm:px-6 sm:py-8 md:pb-10 lg:px-8">
      <nav aria-label="Fil d’Ariane" className="mb-4 text-sm text-gray-500"><a href="/products" className="hover:text-gray-800">Catalogue</a><span aria-hidden="true"> / </span><span aria-current="page">Panier</span></nav>
      <header className="mb-7"><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Votre panier</h1><p className="mt-1 text-sm text-gray-500" aria-live="polite">{formatProductCount(itemCount)}</p></header>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] xl:gap-12">
        <section aria-labelledby="cart-items-title" className="min-w-0 rounded-3xl border border-gray-100 bg-white px-4 shadow-sm sm:px-6">
          <h2 id="cart-items-title" className="sr-only">Produits dans votre panier</h2>
          <ul>{items.map((item) => <CartItem key={item.product.id} item={item} variant="page" currency={tenant.currency} unavailableProductIds={unavailableProductIds} pendingProductIds={pendingProductIds} onIncrement={handleIncrement} onDecrement={handleDecrement} onRemove={handleRemove} />)}</ul>
          {undo && <div className="pb-4"><CartUndoToast productName={undo.item.product.name} onUndo={handleUndo} /></div>}
        </section>
        <aside className="lg:sticky lg:top-6">
          <CartOrderSummary subtotal={subtotal} shippingCost={effectiveShipping} total={total} currency={tenant.currency} canProceed={canProceed} checkoutHint={!canProceed && fulfillmentType === 'delivery' ? 'Indiquez votre adresse pour calculer les frais de livraison.' : null} syncStatus={syncStatus} onCheckout={handleProceed}>{shippingControls}</CartOrderSummary>
        </aside>
      </div>
      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-gray-100 bg-white/95 p-3 backdrop-blur md:hidden" style={{ paddingBottom: 'calc(.75rem + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex max-w-md items-center gap-3"><div className="min-w-24"><p className="text-xs text-gray-500">Total</p><p className="font-bold tabular-nums">{formatPrice(total, tenant.currency)}</p></div><button type="button" onClick={handleProceed} disabled={!canProceed} className="flex-1 rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)' }}>Continuer vers le paiement</button></div>
      </div>
    </div>
  );
}
