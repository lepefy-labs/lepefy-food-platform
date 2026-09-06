'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { IconCheck, IconPhoto, IconX } from '@tabler/icons-react';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';
import { useQuickAdd } from '@/components/catalog/useQuickAdd';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useAddToCartUiStore } from '@/stores/addToCartUiStore';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useTenant } from '@/providers/TenantProvider';
import { formatPrice } from '@/lib/utils/format';

const primary = { backgroundColor: 'var(--color-primary)' };
const actionClass = 'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 hover:opacity-90 active:opacity-80';

function ProductImage({ product, small = false }: { product: ProductCardProduct; small?: boolean }) {
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-lg bg-gray-50 ${small ? 'aspect-square w-full' : 'h-20 w-20'}`}>
      {product.image_url
        ? <Image src={product.image_url} alt="" fill sizes={small ? '160px' : '80px'} className="object-contain" />
        : <IconPhoto aria-hidden="true" className="absolute inset-0 m-auto text-gray-300" size={32} />}
    </div>
  );
}

function RecommendationItem({ product, onAdded, onClose }: {
  product: ProductCardProduct;
  onAdded: (id: string) => void;
  onClose: () => void;
}) {
  const { currency } = useTenant();
  const { addToCart, added, outOfStock, atLimit } = useQuickAdd(product, true);
  return (
    <li className="flex w-36 shrink-0 flex-col rounded-xl border border-gray-200 bg-white p-2 sm:w-auto sm:min-w-0">
      <Link href={`/products/${product.slug}`} onClick={onClose} className="block rounded-lg focus-visible:outline focus-visible:outline-2">
        <ProductImage product={product} small />
        <span className="mt-2 block min-h-10 text-sm font-medium leading-5 text-gray-900 line-clamp-2">{product.name}</span>
      </Link>
      <div className="my-2 mt-auto pt-2">
        <span className="block text-sm font-bold text-gray-900">{formatPrice(product.price, currency)}</span>
        {product.compare_at_price != null && product.compare_at_price > product.price && (
          <span className="block text-xs text-gray-400 line-through">{formatPrice(product.compare_at_price, currency)}</span>
        )}
      </div>
      <button type="button" disabled={outOfStock} aria-disabled={atLimit || undefined}
        aria-label={atLimit ? `Stock maximum pour ${product.name}` : `Ajouter ${product.name}`}
        className={`${actionClass} w-full px-2 text-white disabled:opacity-40 aria-disabled:opacity-60`}
        style={added ? { backgroundColor: '#16a34a' } : primary}
        onClick={() => { if (addToCart()) onAdded(product.id); }}>
        {added ? 'Ajouté ✓' : atLimit ? 'Stock maximum' : outOfStock ? 'Épuisé' : 'Ajouter'}
      </button>
    </li>
  );
}

function ConfirmationPanel({ product, onClose }: { product: ProductCardProduct; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { currency } = useTenant();
  const items = useCartStore(s => s.items);
  const cartItem = items.find(item => item.product.id === product.id);
  const quantity = cartItem?.quantity ?? 0;
  const maxStock = Math.min(product.stock ?? 999, cartItem?.product.stock ?? 999);

  function changeQuantity(delta: -1 | 1) {
    // Read synchronously for each click, including clicks batched before React renders.
    const cart = useCartStore.getState();
    const current = cart.items.find(item => item.product.id === product.id);
    if (!current) return;
    const maximum = Math.min(product.stock ?? 999, current.product.stock ?? 999);
    const next = Math.min(maximum, Math.max(1, current.quantity + delta));
    if (next >= 1 && next !== current.quantity) cart.updateQuantity(product.id, next);
  }
  const [recommendations, setRecommendations] = useState<ProductCardProduct[]>([]);
  const [loading, setLoading] = useState(true);
  // Keep newly added cards visible for feedback and consecutive adds in this opening.
  const [addedHere, setAddedHere] = useState<Set<string>>(() => new Set());
  useFocusTrap(panelRef, true, onClose);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function keepFocus(event: FocusEvent) {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) {
        panelRef.current?.focus({ preventScroll: true });
      }
    }
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('focusin', keepFocus);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => {
      controller.abort();
      if (!disposed) setLoading(false);
    }, 8000);
    void (async () => {
      try {
        const response = await fetch(`/api/products/${encodeURIComponent(product.id)}/recommendations?limit=4`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json() as { products?: ProductCardProduct[] };
        if (!disposed && !controller.signal.aborted && Array.isArray(data.products)) {
          setRecommendations(data.products.filter(p => p.id !== product.id && p.stock !== 0).slice(0, 4));
        }
      } catch {
        // Suggestions are optional. The confirmed local cart addition is unaffected.
      } finally {
        clearTimeout(timeout);
        if (!disposed) setLoading(false);
      }
    })();
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [product.id]);

  const visible = recommendations.filter(p => addedHere.has(p.id) || !items.some(item => item.product.id === p.id));
  const details = [product.category?.name, product.weight_grams ? `${product.weight_grams} g` : null].filter(Boolean).join(' · ');

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      data-testid="add-confirmation-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="add-confirmation-title" tabIndex={-1}
        className="max-h-[85dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl bg-white shadow-2xl outline-none sm:max-w-[800px] sm:rounded-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="px-4 pb-4 pt-2 sm:p-6">
          <div aria-hidden="true" className="mx-auto mb-1 h-1 w-10 rounded-full bg-gray-200 sm:hidden" />
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="add-confirmation-title" className="flex items-center gap-2 text-lg font-bold text-gray-900">
              <IconCheck size={22} className="shrink-0 text-green-600" aria-hidden="true" />Ajouté au panier
            </h2>
            <button type="button" onClick={onClose} aria-label="Fermer la confirmation"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2">
              <IconX size={22} aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <ProductImage product={product} />
            <div className="min-w-0">
              <Link href={`/products/${product.slug}`} onClick={onClose}
                className="line-clamp-2 rounded-sm text-sm font-semibold text-gray-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:text-base">{product.name}</Link>
              {details && <p className="mt-0.5 truncate text-xs text-gray-500">{details}</p>}
              <p className="mt-1 font-bold text-gray-900">{formatPrice(product.price, currency)}</p>
              <div role="group" aria-label={`Quantité de ${product.name}`}
                className="mt-2 inline-flex items-center rounded-lg border border-gray-300 bg-white text-gray-900">
                <button type="button" onClick={() => changeQuantity(-1)} disabled={quantity <= 1}
                  aria-label={`Diminuer la quantité de ${product.name}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-l-lg text-xl font-medium hover:bg-gray-50 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 disabled:bg-gray-50 disabled:text-gray-400">
                  −
                </button>
                <span aria-live="polite" aria-atomic="true" data-testid="confirmation-quantity"
                  className="min-w-10 border-x border-gray-300 px-2 text-center text-sm font-semibold tabular-nums">
                  <span className="sr-only">Quantité dans le panier : </span>{quantity}
                </span>
                <button type="button" onClick={() => changeQuantity(1)} disabled={!cartItem || quantity >= maxStock}
                  aria-label={`Augmenter la quantité de ${product.name}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-r-lg text-xl font-medium hover:bg-gray-50 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 disabled:bg-gray-50 disabled:text-gray-400">
                  +
                </button>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Link href="/cart" onClick={onClose} className={`${actionClass} text-white sm:order-2`} style={primary}>Voir mon panier</Link>
            <button type="button" onClick={onClose} className={`${actionClass} border border-gray-300 text-gray-700 sm:order-1`}>Continuer mes achats</button>
          </div>
        </div>
        {(loading || visible.length > 0) && (
          <section aria-labelledby="add-recommendations-title" aria-busy={loading} className="border-t border-gray-100 px-4 py-4 sm:px-6">
            <h3 id="add-recommendations-title" className="mb-3 text-base font-semibold text-gray-900">Vous aimerez peut-être aussi</h3>
            {loading ? (
              <div className="flex gap-3 overflow-hidden sm:grid sm:grid-cols-4" role="status" aria-label="Chargement des suggestions">
                {[0, 1, 2, 3].map(index => <div key={index} className="h-48 w-36 shrink-0 animate-pulse rounded-xl bg-gray-100 motion-reduce:animate-none sm:w-auto" />)}
              </div>
            ) : (
              <ul className="flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-4">
                {visible.map(p => <RecommendationItem key={p.id} product={p} onClose={onClose}
                  onAdded={id => setAddedHere(previous => new Set(previous).add(id))} />)}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** One global instance; no dialog markup is duplicated by catalogue cards. */
export function AddToCartConfirmation() {
  const product = useAddToCartUiStore(s => s.product);
  const revision = useAddToCartUiStore(s => s.revision);
  const close = useAddToCartUiStore(s => s.close);
  const drawerOpen = useCartUiStore(s => s.isDrawerOpen);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => { close(); }, [pathname, search, close]);
  useEffect(() => { if (drawerOpen) close(); }, [drawerOpen, close]);

  return product && !drawerOpen ? <ConfirmationPanel key={revision} product={product} onClose={close} /> : null;
}
