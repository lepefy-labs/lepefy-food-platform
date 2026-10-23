'use client';

import { useEffect, useState } from 'react';
import { IconPhoto, IconX } from '@tabler/icons-react';
import { LepefyImage } from '@/components/images/LepefyImage';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';
import { useQuickAdd } from '@/components/catalog/useQuickAdd';
import { useCartStore } from '@/stores/cartStore';
import { describePrice, resolveSellingFormat } from '@/lib/storefrontCopy/sellingFormat';
import { recordAddSource } from '@/lib/cart/recordAddSource';

const LIMIT = 4;
const DISMISS_KEY = 'lepefy-checkout-add-ons-dismissed';

function AddOnItem({ product, currency, onAdded }: { product: ProductCardProduct; currency: string; onAdded: () => void }) {
  const { addToCart, added, outOfStock, atLimit } = useQuickAdd(product, true);
  const minimum = product.min_order_quantity ?? 1;
  const price = describePrice(product.price, resolveSellingFormat(product), currency);
  const disabled = outOfStock || atLimit;
  return (
    <li className="flex min-w-0 items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-2">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-50">
        {product.image_url
          ? <LepefyImage src={product.image_url} variant="thumbnail" alt="" fill sizes="48px" className="object-contain" />
          : <IconPhoto aria-hidden="true" className="absolute inset-0 m-auto text-gray-300" size={22} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{product.name}</p>
        <p className="text-xs text-gray-700"><span className="font-bold">{price.amount}</span> {price.unitPhrase}</p>
      </div>
      <button
        type="button"
        disabled={disabled || added}
        onClick={() => { if (addToCart()) { recordAddSource(product.id, 'checkout_delivery'); onAdded(); } }}
        aria-label={minimum > 1 ? `Ajouter ${minimum} ${product.name}` : `Ajouter ${product.name}`}
        className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {added ? 'Ajouté ✓' : minimum > 1 ? `Ajouter ${minimum}` : 'Ajouter'}
      </button>
    </li>
  );
}

/**
 * « Un petit plus ? » à l'étape livraison du checkout (jamais au paiement) :
 * au plus 4 petits plus choisis par la boutique (jamais un gros complémentaire
 * qui détourne du paiement), un clic
 * pour ajouter, « Non merci » la masque pour la session. Chaque ajout change le
 * panier : le parent invalide le devis, recalculé avec le nouveau poids.
 */
export function CheckoutAddOns({ currency, onCartChanged }: { currency: string; onCartChanged: () => void }) {
  const [products, setProducts] = useState<ProductCardProduct[]>([]);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let hidden = false;
    try { hidden = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { /* stockage indisponible */ }
    setDismissed(hidden);
    if (hidden) return;
    const controller = new AbortController();
    const ids = useCartStore.getState().items.map((item) => item.product.id).slice(0, 30);
    const params = new URLSearchParams({ limit: String(LIMIT), only: 'add_ons' });
    if (ids.length) params.set('ids', ids.join(','));
    fetch(`/api/cart/suggestions?${params.toString()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { products: [] }))
      .then((data: { products?: ProductCardProduct[] }) => setProducts((data.products ?? []).slice(0, LIMIT)))
      .catch(() => { /* bloc facultatif */ });
    return () => controller.abort();
  }, []);

  if (dismissed || products.length === 0) return null;
  return (
    <section aria-labelledby="checkout-add-ons-title" className="rounded-2xl border border-gray-200 bg-gray-50/70 p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="checkout-add-ons-title" className="text-sm font-bold text-gray-900">Un petit plus ?</h2>
        <button
          type="button"
          onClick={() => { try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* confort */ } setDismissed(true); }}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-gray-700 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          <IconX size={14} aria-hidden="true" /> Non merci
        </button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {products.map((product) => <AddOnItem key={product.id} product={product} currency={currency} onAdded={onCartChanged} />)}
      </ul>
    </section>
  );
}
