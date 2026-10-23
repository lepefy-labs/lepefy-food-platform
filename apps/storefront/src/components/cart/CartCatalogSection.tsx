'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconRefresh } from '@tabler/icons-react';
import { ProductCard, type ProductCardProduct } from '@/components/catalog/ProductCard';
import { ProductCardSkeleton } from '@/components/catalog/ProductGrid';
import { CatalogShelf } from '@/components/catalog/CatalogShelf';
import { useInfiniteProducts } from '@/lib/catalog/useInfiniteProducts';
import { MAX_EXCLUDED_IDS } from '@/lib/catalog/catalogLimits';
import { useCartStore } from '@/stores/cartStore';
import { useTenant } from '@/providers/TenantProvider';
import { readableOn } from '@/lib/utils/color';
import { CART_SUGGESTION_LIMIT, MAX_CART_SUGGESTION_LIMIT } from '@/lib/cart/cartSuggestionRules';
import { fitsHeadroom, parcelFitLabel, selectParcelFits } from '@/lib/cart/parcelFit';
import { recordAddSource } from '@/lib/cart/recordAddSource';
import { formatHeadroom } from '@/lib/shipping/tariff/shippingEstimate';

/** Taille des pages du catalogue intégré (plus petite que le Catalogue : chargement léger). */
const CART_CATALOG_PAGE_SIZE = 12;
const RESTORE_KEY = 'lepefy-cart-catalog';
const RESTORE_MAX_AGE_MS = 30 * 60 * 1000;
const NO_PRODUCTS: ProductCardProduct[] = [];
/** 2 colonnes sur mobile, 3 ensuite ; 4 sur grand écran quand la section a toute la largeur. */
const GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4';
const CHIP = 'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1 motion-reduce:transition-none';

export interface CartCatalogCategory {
  id: string;
  slug: string;
  name: string;
}

interface SavedState {
  category: string | null;
  pages: number;
  y: number;
  at: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readSavedState(): SavedState | null {
  try {
    // Retirée seulement une fois la restauration lancée (double montage en développement).
    const raw = sessionStorage.getItem(RESTORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedState;
    if (Date.now() - saved.at > RESTORE_MAX_AGE_MS || !Number.isInteger(saved.pages) || saved.pages < 1) return null;
    return { ...saved, pages: Math.min(saved.pages, 20) };
  } catch {
    return null;
  }
}

/** Durée pendant laquelle la carte touchée est maintenue sous le doigt. */
const KEEP_IN_PLACE_MS = 1200;

/**
 * Un ajout ou un retrait depuis une carte modifie le panier au-dessus (ligne
 * ajoutée, avis de groupe, vérification) : la carte touchée est maintenue à
 * la même hauteur à chaque image pendant un court instant (iOS n'a pas
 * d'ancrage de défilement). Le premier défilement du client arrête tout.
 */
function keepInPlace(element: Element) {
  const top = element.getBoundingClientRect().top;
  const until = performance.now() + KEEP_IN_PLACE_MS;
  let stopped = false;
  const stop = () => { stopped = true; };
  const events = ['wheel', 'touchmove', 'keydown'] as const;
  events.forEach((name) => window.addEventListener(name, stop, { once: true, passive: true }));
  function tick() {
    if (stopped || !element.isConnected || performance.now() > until) {
      events.forEach((name) => window.removeEventListener(name, stop));
      return;
    }
    const delta = element.getBoundingClientRect().top - top;
    if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * Suite d'achat sous le panier (vide ou non) : « Complétez votre panier »
 * (`/api/cart/suggestions`, données réelles uniquement) puis « Tous les
 * produits » en grille, avec des filtres de catégorie du tenant. Le scroll
 * infini partage le hook du Catalogue (`useInfiniteProducts`, pages de 12 via
 * `/api/products`) et ne démarre qu'à l'approche de la section. Les produits
 * suggérés sont exclus de la liste non filtrée (`exclude=`, retiré avant le
 * découpage en pages : ni trou ni répétition) — ils restent visibles juste
 * au-dessus. Les cartes ajoutent sans confirmation (`confirmOnAdd={false}`) :
 * le bouton devient le +/− partagé, total et badge se mettent à jour, la
 * position ne bouge pas. Retour d'une fiche produit : mêmes pages rechargées
 * (prix et stock frais), même position.
 */
export function CartCatalogSection({ categories, wide = false, headroomG = null, estimateSettled = true }: {
  categories: CartCatalogCategory[];
  wide?: boolean;
  /** Marge de tranche estimée (grammes, arrondie) : active « Ça rentre dans votre colis ». */
  headroomG?: number | null;
  /** Première estimation reçue : le bloc de suggestions est choisi une seule fois, ensuite. */
  estimateSettled?: boolean;
}) {
  const [fetched, setFetched] = useState<ProductCardProduct[] | null>(null);
  const [shelf, setShelf] = useState<{ fits: boolean; products: ProductCardProduct[] } | null>(null);
  const suggestions = shelf?.products ?? null;
  const [category, setCategory] = useState<string | null>(null);
  const [day] = useState(today);
  const restoreRef = useRef<SavedState | null>(null);
  const [restoring, setRestoring] = useState(false);
  const onPrimary = readableOn(useTenant().primary_color);
  // Une seule fois, avec le panier du moment : la liste ne se réordonne pas sous le doigt.
  useEffect(() => {
    restoreRef.current = readSavedState();
    if (restoreRef.current) {
      setRestoring(true);
      setCategory(restoreRef.current.category);
    }
    const controller = new AbortController();
    const ids = useCartStore.getState().items.map((item) => item.product.id).slice(0, 30);
    const params = new URLSearchParams();
    if (ids.length) params.set('ids', ids.join(','));
    // Plus que le bloc n'en montre : de quoi garder ceux qui rentrent dans le colis.
    params.set('limit', String(MAX_CART_SUGGESTION_LIMIT));
    fetch(`/api/cart/suggestions?${params.toString()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { products: [] }))
      .then((data: { products?: ProductCardProduct[] }) => setFetched(data.products ?? []))
      .catch(() => { if (!controller.signal.aborted) setFetched([]); });
    return () => controller.abort();
  }, []);

  // Choisi une seule fois (suggestions et estimation connues) : le bloc ne change pas sous le doigt après un ajout.
  // Au moins deux produits qui rentrent dans le colis : « Ça rentre dans votre colis », sinon « Complétez votre panier ».
  useEffect(() => {
    if (shelf || fetched === null || !estimateSettled) return;
    const fits = selectParcelFits(fetched, headroomG, CART_SUGGESTION_LIMIT);
    setShelf(fits.length >= 2 ? { fits: true, products: fits } : { fits: false, products: fetched.slice(0, CART_SUGGESTION_LIMIT) });
  }, [shelf, fetched, estimateSettled, headroomG]);

  const excludeKey = !category && suggestions ? suggestions.map((product) => product.id).slice(0, MAX_EXCLUDED_IDS).join(',') : '';
  const buildParams = useCallback(() => {
    const params = new URLSearchParams({ limit: String(CART_CATALOG_PAGE_SIZE), day });
    if (category) params.set('category', category);
    else if (excludeKey) params.set('exclude', excludeKey);
    return params;
  }, [category, day, excludeKey]);

  const catalog = useInfiniteProducts<ProductCardProduct>({
    initialItems: NO_PRODUCTS,
    initialPage: 0,
    initialHasMore: true,
    buildParams,
    // Attend les suggestions (exclusions connues) et une éventuelle restauration.
    autoLoad: suggestions !== null && !restoring,
    rootMargin: '0px 0px 800px 0px',
  });
  const { reset } = catalog;

  // Retour d'une fiche produit : recharge les mêmes pages puis la même position.
  useEffect(() => {
    const saved = restoreRef.current;
    if (!saved || suggestions === null) return;
    restoreRef.current = null;
    try { sessionStorage.removeItem(RESTORE_KEY); } catch { /* storage disabled */ }
    const controller = new AbortController();
    const pages = Array.from({ length: saved.pages }, (_, i) => i + 1);
    Promise.all(pages.map((page) => {
      const params = buildParams();
      params.set('page', String(page));
      return fetch(`/api/products?${params.toString()}`, { signal: controller.signal })
        .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }) as Promise<{ products?: ProductCardProduct[]; hasNextPage?: boolean }>;
    }))
      .then((results) => {
        const seen = new Set<string>();
        const merged = results.flatMap((result) => result.products ?? []).filter((product) => !seen.has(product.id) && Boolean(seen.add(product.id)));
        reset(merged, saved.pages, Boolean(results[results.length - 1]?.hasNextPage));
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, saved.y)));
      })
      .catch(() => { /* restauration facultative : le scroll infini reprend normalement */ })
      .finally(() => setRestoring(false));
    return () => controller.abort();
  }, [suggestions, buildParams, reset]);

  function selectCategory(slug: string | null) {
    if (slug === category) return;
    setCategory(slug);
    reset(NO_PRODUCTS, 0, true);
  }

  // Avant un clic dans la section : position (compensation d'un ajout) et, pour
  // une fiche produit, de quoi revenir au même endroit par « retour ».
  function rememberPosition(event: React.MouseEvent) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button');
    if (button) keepInPlace(button.closest('li') ?? button);
    if (!event.target.closest('a[href^="/products/"]') || event.target.closest('button')) return;
    try {
      sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ category, pages: Math.max(1, catalog.page), y: Math.round(window.scrollY), at: Date.now() } satisfies SavedState));
    } catch { /* storage disabled */ }
  }

  const { items, hasMore, isLoadingMore, loadMoreFailed } = catalog;
  const empty = items.length === 0 && !hasMore && !isLoadingMore;

  return (
    <div className="mt-8 space-y-8" onClickCapture={rememberPosition}>
      {suggestions === null ? (
        <section aria-label="Complétez votre panier" aria-busy="true">
          <div className="mb-3 h-7 w-56 animate-pulse rounded bg-gray-200/70 motion-reduce:animate-none" />
          <div className="-mx-4 flex gap-3 overflow-hidden px-4" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="w-[44vw] max-w-[220px] shrink-0 sm:w-[30vw]"><ProductCardSkeleton /></div>
            ))}
          </div>
        </section>
      ) : (
        <CatalogShelf id="cart-suggestions" tone="novelty" confirmOnAdd={false} className="" products={suggestions}
          title={shelf?.fits ? 'Ça rentre dans votre colis' : 'Complétez votre panier'} icon={shelf?.fits ? '📦' : '🧺'}
          subtitle={shelf?.fits && headroomG ? `Encore ${formatHeadroom(headroomG)} sans frais de livraison en plus` : null}
          // Étiquette seulement tant que le produit rentre encore (la marge baisse à chaque ajout).
          note={shelf?.fits ? (product) => (fitsHeadroom(product, headroomG) ? parcelFitLabel(product) : null) : undefined}
          onAdded={(product) => recordAddSource(product.id, shelf?.fits ? 'cart_fits' : 'cart_suggestions')} />
      )}

      <section aria-labelledby="cart-catalog-title">
        <h2 id="cart-catalog-title" className="font-display text-xl font-bold text-gray-900">Tous les produits</h2>
        {categories.length > 1 && (
          <div role="group" aria-label="Filtrer par catégorie" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
            {[{ slug: null as string | null, name: 'Tout' }, ...categories].map((entry) => {
              const active = entry.slug === category;
              return (
                <button key={entry.slug ?? 'all'} type="button" aria-pressed={active} onClick={() => selectCategory(entry.slug)}
                  className={`${CHIP} ${active ? 'border-transparent' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'}`}
                  style={active ? { backgroundColor: 'var(--color-primary)', color: onPrimary } : undefined}>
                  {entry.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4">
          {empty ? (
            <p className="rounded-2xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-700" role="status">Aucun produit dans cette catégorie.</p>
          ) : (
            <ul className={`${GRID} ${wide ? 'lg:grid-cols-4' : ''}`}>
              {items.map((product) => (
                <li key={product.id} className="min-w-0">
                  <ProductCard product={product} compactMobile confirmOnAdd={false} />
                </li>
              ))}
              {(isLoadingMore || restoring || (items.length === 0 && hasMore && !loadMoreFailed)) && Array.from({ length: items.length ? 4 : 6 }).map((_, i) => (
                <li key={`skeleton-${i}`} aria-hidden="true"><ProductCardSkeleton /></li>
              ))}
            </ul>
          )}
          <p className="sr-only" role="status" aria-live="polite">{isLoadingMore ? 'Chargement de produits supplémentaires…' : ''}</p>
          {loadMoreFailed && (
            <div className="mt-6 flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-gray-600">Impossible de charger la suite des produits.</p>
              <button type="button" onClick={() => void catalog.loadMore()}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-gray-300 bg-white px-6 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
                <IconRefresh size={16} aria-hidden="true" /> Réessayer
              </button>
            </div>
          )}
          {hasMore && <div ref={catalog.sentinelRef} className="h-px" aria-hidden="true" />}
          {!hasMore && items.length > 0 && (
            <p className="mt-8 text-center text-sm text-gray-500">Vous avez vu tous les produits.</p>
          )}
        </div>
      </section>
    </div>
  );
}
