'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { IconShoppingCartOff, IconTruck, IconBuildingStore, IconMapPin } from '@tabler/icons-react';
import { useCartStore } from '@/stores/cartStore';
import { formatPrice } from '@/lib/utils/format';
import type { Tenant } from '@lepefy/types';

const COUNTRIES = [
  { value: 'IT', label: 'Italie' },
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'CH', label: 'Suisse' },
];

interface Props {
  tenant: Tenant;
}

export default function CartClient({ tenant }: Props) {
  const { items, updateQuantity, removeItem, totalPrice, shippingPayload } = useCartStore();
  const router = useRouter();

  const [fulfillmentType, setFulfillmentType] = useState<'delivery' | 'pickup'>('delivery');
  const [country, setCountry] = useState('IT');
  const [postalCode, setPostalCode] = useState('');
  const [shippingTotal, setShippingTotal] = useState<number | null>(null);
  const [shippingDetails, setShippingDetails] = useState<Record<string, unknown> | null>(null);
  const [quoteToken, setQuoteToken] = useState<string | null>(null);
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [shippingLoading, setShippingLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subtotal = totalPrice();
  const effectiveShipping = fulfillmentType === 'pickup' ? 0 : (shippingTotal ?? null);
  const total = subtotal + (effectiveShipping ?? 0);

  const fetchShipping = useCallback(
    async (zip: string, c: string) => {
      if (zip.length < 4) return;
      setShippingLoading(true);
      setShippingError(null);
      try {
        const res = await fetch('/api/shipping/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: shippingPayload(),
            to: { country: c, zip_code: zip },
          }),
        });
        const data = await res.json();
        if (data.available) {
          setShippingTotal(data.shippingTotal);
          setShippingDetails(data.shippingDetails ?? null);
          setQuoteToken(data.quoteToken ?? null);
        } else {
          setShippingError(data.message ?? 'Livraison non disponible pour cette adresse.');
          setShippingTotal(null);
          setShippingDetails(null);
          setQuoteToken(null);
        }
      } catch {
        setShippingError('Erreur lors du calcul des frais de livraison.');
        setShippingTotal(null);
        setShippingDetails(null);
        setQuoteToken(null);
      } finally {
        setShippingLoading(false);
      }
    },
    [shippingPayload],
  );

  useEffect(() => {
    if (fulfillmentType === 'pickup') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchShipping(postalCode, country), 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [postalCode, country, fulfillmentType, fetchShipping]);

  const canProceed =
    items.length > 0 && (fulfillmentType === 'pickup' || shippingTotal !== null);

  const handleProceed = () => {
    sessionStorage.setItem(
      'lepefy-checkout-shipping',
      JSON.stringify({
        shippingTotal: fulfillmentType === 'pickup' ? 0 : shippingTotal,
        shippingDetails: fulfillmentType === 'pickup' ? null : shippingDetails,
        quoteToken: fulfillmentType === 'pickup' ? null : quoteToken,
        fulfillmentType,
        country: fulfillmentType === 'delivery' ? country : null,
        postalCode: fulfillmentType === 'delivery' ? postalCode : null,
      }),
    );
    router.push('/checkout');
  };

  if (items.length === 0) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
        <IconShoppingCartOff size={56} className="text-gray-300 mb-4" stroke={1.25} />
        <h1 className="text-2xl font-bold mb-2">Votre panier est vide</h1>
        <p className="text-gray-500 mb-6">
          Ajoutez des produits pour commencer votre commande.
        </p>
        <Link
          href="/products"
          className="px-6 py-3 rounded-2xl font-semibold text-white text-sm"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          Voir le catalogue
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
      <h1 className="text-2xl font-bold mb-6">Mon panier</h1>

      {/* Items */}
      <div className="space-y-3 mb-6">
        {items.map((item) => (
          <div
            key={item.product.id}
            className="flex gap-3 bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
          >
            {item.product.image_url && (
              <Image
                src={item.product.image_url}
                alt={item.product.name}
                width={64}
                height={64}
                className="w-16 h-16 object-cover rounded-xl flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-sm leading-snug line-clamp-2">
                  {item.product.name}
                </p>
                <button
                  onClick={() => removeItem(item.product.id)}
                  className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5"
                  aria-label="Supprimer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                    className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-sm font-bold text-gray-600 hover:bg-gray-50 active:bg-gray-100"
                  >
                    −
                  </button>
                  <span className="w-5 text-center text-sm font-semibold">{item.quantity}</span>
                  <button
                    onClick={() =>
                      updateQuantity(
                        item.product.id,
                        Math.min(item.quantity + 1, item.product.stock),
                      )
                    }
                    disabled={item.quantity >= item.product.stock}
                    className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-sm font-bold text-gray-600 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
                <span className="font-semibold text-sm">
                  {formatPrice(item.product.price * item.quantity, tenant.currency)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Subtotal */}
      <div className="flex justify-between text-sm mb-6 px-1">
        <span className="text-gray-500">Sous-total</span>
        <span className="font-semibold">{formatPrice(subtotal, tenant.currency)}</span>
      </div>

      {/* Fulfillment type */}
      {tenant.click_collect_enabled && (
        <div className="mb-6">
          <p className="text-sm font-semibold text-gray-700 mb-3">Mode de récupération</p>
          <div className="flex gap-3">
            {(['delivery', 'pickup'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFulfillmentType(type)}
                className={`flex-1 py-3 rounded-2xl border text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                  fulfillmentType === type
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-light,#f0fdf4)]'
                    : 'border-gray-200 text-gray-600'
                }`}
              >
                {type === 'delivery' ? <IconTruck size={18} /> : <IconBuildingStore size={18} />}
                {type === 'delivery' ? 'Livraison' : 'Click & Collect'}
              </button>
            ))}
          </div>
          {fulfillmentType === 'pickup' && tenant.click_collect_address && (
            <div className="mt-3 p-4 bg-gray-50 rounded-2xl text-sm text-gray-700">
              <p className="font-semibold mb-1 flex items-center gap-1.5">
                <IconMapPin size={16} /> Adresse de retrait
              </p>
              <p>{tenant.click_collect_address}</p>
            </div>
          )}
        </div>
      )}

      {/* Shipping calculator */}
      {fulfillmentType === 'delivery' && (
        <div className="mb-6">
          <p className="text-sm font-semibold text-gray-700 mb-3">Frais de livraison</p>
          <div className="flex gap-3 mb-3">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              {COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Code postal"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              maxLength={10}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div className="flex justify-between items-center px-1 text-sm h-5">
            <span className="text-gray-500">Livraison</span>
            {shippingLoading && (
              <span className="text-gray-400 text-xs animate-pulse">Calcul en cours…</span>
            )}
            {!shippingLoading && shippingTotal !== null && (
              <span className="font-semibold">{formatPrice(shippingTotal, tenant.currency)}</span>
            )}
            {!shippingLoading && shippingError && (
              <span className="text-red-500 text-xs max-w-[60%] text-right">{shippingError}</span>
            )}
            {!shippingLoading && shippingTotal === null && !shippingError && (
              <span className="text-gray-300">—</span>
            )}
          </div>
        </div>
      )}

      {fulfillmentType === 'pickup' && (
        <div className="flex justify-between text-sm mb-6 px-1">
          <span className="text-gray-500">Livraison</span>
          <span className="font-semibold text-green-600">Gratuit</span>
        </div>
      )}

      {/* Total */}
      <div className="flex justify-between font-bold text-base border-t border-gray-100 pt-4 mb-8 px-1">
        <span>Total</span>
        <span>
          {canProceed
            ? formatPrice(total, tenant.currency)
            : formatPrice(subtotal, tenant.currency)}
        </span>
      </div>

      {/* CTA — fixed on mobile */}
      <div className="fixed bottom-0 left-0 right-0 p-4 pb-[calc(1rem+64px)] bg-white border-t border-gray-100 sm:static sm:border-0 sm:p-0 sm:pb-0 sm:bg-transparent">
        <button
          onClick={handleProceed}
          disabled={!canProceed}
          className="w-full py-4 rounded-2xl font-bold text-white text-base transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          Procéder au paiement
        </button>
        {!canProceed && fulfillmentType === 'delivery' && (
          <p className="text-center text-xs text-gray-400 mt-2">
            Entrez votre code postal pour calculer les frais de livraison.
          </p>
        )}
      </div>
    </div>
  );
}
