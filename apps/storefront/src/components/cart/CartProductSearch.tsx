'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { IconArrowRight, IconLoader2, IconPhoto, IconPlus, IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';
import { useQuickAdd } from '@/components/catalog/useQuickAdd';
import { AvailabilityBadge } from '@/components/catalog/AvailabilityBadge';
import { PromoBadge } from '@/components/catalog/PromoBadge';
import { LepefyImage } from '@/components/images/LepefyImage';
import { useProductSuggestions } from '@/components/search/useProductSuggestions';
import { catalogSearchHref } from '@/lib/catalog/catalogSearchUrl';
import { rememberShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { useCartLineQuantity } from '@/lib/cart/useCartLineQuantity';
import { describePrice, formatCount, resolveSellingFormat } from '@/lib/storefrontCopy/sellingFormat';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useTenant } from '@/providers/TenantProvider';
import { accentTextOnWhite } from '@/lib/utils/color';
import { CartStepper } from './CartStepper';

const MOBILE_QUERY = '(max-width: 767px)';

interface CartProductSearchProps {
  currency?: string;
  /** «−» d'un résultat déjà au panier : même chemin que les lignes (retrait au minimum avec annulation). */
  onDecrement: (productId: string) => void;
}

/**
 * Recherche dans le panier : le même moteur que la recherche globale
 * (`useProductSuggestions`), présenté en liste dans la page pour ajouter un
 * produit sans quitter le panier. « Ajouter » pose la quantité minimale
 * (`useQuickAdd` → `cartStore.addItem`), puis le résultat montre le même +/−
 * que les lignes (pas de la règle, stock). Valider le champ ferme le clavier,
 * jamais une navigation ; le nom du produit ouvre sa fiche. Pendant la saisie,
 * BottomNav et barre « Livraison et paiement » s'effacent (`cartSearchActive`).
 */
export function CartProductSearch({ currency, onDecrement }: CartProductSearchProps) {
  const id = useId();
  const resultsId = `${id}-results`;
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const setSearchActive = useCartUiStore((s) => s.setCartSearchActive);
  const suggestions = useProductSuggestions(query);
  const { searchable, loading, showResults, error, products, total } = suggestions;
  const trimmed = query.trim();

  // Quitter la page clavier ouvert ne doit jamais laisser la navigation masquée.
  useEffect(() => () => setSearchActive(false), [setSearchActive]);

  function handleFocus() {
    setSearchActive(true);
    // Mobile : le champ remonte sous l'en-tête pour laisser la place aux résultats au-dessus du clavier.
    if (window.matchMedia(MOBILE_QUERY).matches) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }));
    }
  }

  function clear() {
    setQuery('');
    setAnnouncement('');
    inputRef.current?.focus();
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Ferme le clavier : les résultats restent affichés dans la page.
    inputRef.current?.blur();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      setQuery('');
    }
  }

  function rememberSearch() {
    rememberShoppingReturn({ pathname: '/', search: new URLSearchParams({ q: trimmed }).toString() });
  }

  const statusMessage = !searchable
    ? announcement
    : loading
      ? 'Recherche en cours…'
      : error
        ? 'La recherche ne répond pas.'
        : showResults
          ? announcement || (products.length === 0 ? 'Aucun produit trouvé' : `${products.length} produit${products.length > 1 ? 's' : ''} proposé${products.length > 1 ? 's' : ''}`)
          : '';

  return (
    <section aria-label="Ajouter un produit au panier" className="space-y-2">
      <form ref={formRef} role="search" onSubmit={handleSubmit} className="scroll-mt-16 md:scroll-mt-44" action="/">
        <div className="flex h-12 items-center gap-3 rounded-xl border-[1.5px] border-[color:var(--field-border)] bg-[color:var(--field-bg)] px-3.5 transition-shadow focus-within:border-[var(--color-primary)] focus-within:bg-white focus-within:shadow-[0_0_0_1px_var(--color-primary),0_0_0_5px_var(--field-ring)] motion-reduce:transition-none">
          {loading
            ? <IconLoader2 size={20} className="shrink-0 animate-spin text-gray-600 motion-reduce:animate-none" aria-hidden="true" />
            : <IconSearch size={20} className="shrink-0 text-gray-600" aria-hidden="true" />}
          <input
            ref={inputRef}
            type="search"
            name="q"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setAnnouncement(''); }}
            onFocus={handleFocus}
            onBlur={() => setSearchActive(false)}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher un produit..."
            aria-label="Rechercher un produit à ajouter au panier"
            aria-controls={searchable ? resultsId : undefined}
            autoComplete="off"
            enterKeyHint="search"
            className="min-w-0 flex-1 border-none bg-transparent text-base text-gray-950 outline-none placeholder:text-[color:var(--field-placeholder)] focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              // Le champ garde le focus (et le clavier reste ouvert).
              onMouseDown={(event) => event.preventDefault()}
              onClick={clear}
              aria-label="Effacer la recherche"
              className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <IconX size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>

      <p className="sr-only" role="status" aria-live="polite">{statusMessage}</p>

      {searchable && (
        <div id={resultsId} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {loading && !showResults ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-gray-700">
              <IconLoader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Recherche en cours…
            </p>
          ) : error ? (
            <div className="px-4 py-3">
              <p className="text-sm font-bold text-gray-900">La recherche ne répond pas.</p>
              <p className="mt-0.5 text-sm text-gray-600">Vérifiez votre connexion.</p>
              <button type="button" onClick={suggestions.retry}
                className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold underline underline-offset-2" style={{ color: 'var(--color-primary)' }}>
                <IconRefresh size={16} aria-hidden="true" />Réessayer
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="px-4 py-3">
              <p className="text-sm font-bold text-gray-900">Aucun produit trouvé</p>
              <p className="mt-0.5 text-sm text-gray-600">Vérifiez l&apos;orthographe ou essayez un autre mot.</p>
            </div>
          ) : (
            <>
              <ul aria-label={`Résultats pour « ${trimmed} »`} className="divide-y divide-gray-100">
                {products.map((product) => (
                  <CartSearchResult
                    key={product.id}
                    product={product}
                    currency={currency}
                    onOpen={rememberSearch}
                    onAdded={(count) => setAnnouncement(`${product.name} ajouté au panier (${count})`)}
                    onDecrement={onDecrement}
                  />
                ))}
              </ul>
              {total > products.length && (
                <Link href={catalogSearchHref(trimmed)} onClick={rememberSearch}
                  className="flex min-h-12 items-center justify-between border-t border-gray-100 px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]"
                  style={{ color: 'var(--color-primary)' }}>
                  Voir tous les résultats ({total})
                  <IconArrowRight size={18} aria-hidden="true" />
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function CartSearchResult({ product, currency, onOpen, onAdded, onDecrement }: {
  product: ProductCardProduct;
  currency?: string;
  onOpen: () => void;
  onAdded: (count: string) => void;
  onDecrement: (productId: string) => void;
}) {
  const { addToCart, atLimit, availability } = useQuickAdd(product, true);
  // Texte du bouton lisible sur blanc quelle que soit la couleur du tenant.
  const accent = accentTextOnWhite(useTenant().primary_color);
  const line = useCartLineQuantity(product.id);
  const actionRef = useRef<HTMLDivElement>(null);
  const focusStepperAfterAdd = useRef(false);
  const format = resolveSellingFormat(product);
  const price = describePrice(product.price, format, currency);
  const minimum = product.min_order_quantity ?? 1;
  const unavailable = availability === 'sold_out' || availability === 'below_minimum';
  const inCart = line.quantity > 0;
  const href = `/products/${product.slug}`;

  // « Ajouter » laisse place au +/− : le focus clavier suit sur le «+».
  useEffect(() => {
    if (!inCart || !focusStepperAfterAdd.current) return;
    focusStepperAfterAdd.current = false;
    const buttons = actionRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
    buttons?.[buttons.length - 1]?.focus({ preventScroll: true });
  }, [inCart]);

  function add() {
    if (!addToCart()) return;
    focusStepperAfterAdd.current = true;
    onAdded(formatCount(format, minimum));
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Link href={href} onClick={onOpen} tabIndex={-1} aria-hidden="true"
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-50 ring-1 ring-black/5">
        {product.image_url
          ? <LepefyImage src={product.image_url} variant="thumbnail" alt="" fill sizes="56px" className={`object-contain ${unavailable ? 'opacity-50 grayscale' : ''}`} />
          : <IconPhoto size={22} aria-hidden="true" className="absolute inset-0 m-auto text-gray-300" />}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={href} onClick={onOpen}
          className="line-clamp-2 text-sm font-semibold leading-5 text-gray-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
          {product.name}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-900">
          <span><span className="font-bold">{price.amount}</span> <span className="text-xs font-medium text-gray-700">{price.unitPhrase}</span></span>
          {!unavailable && <PromoBadge product={product} size="sm" />}
          {unavailable
            ? <AvailabilityBadge state={availability} />
            : minimum > 1 && !inCart && (
              <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-900">{minimum} minimum</span>
            )}
        </p>
      </div>
      <div ref={actionRef} className="shrink-0">
        {unavailable ? null : inCart ? (
          <CartStepper
            quantity={line.quantity}
            productName={product.name}
            removesOnDecrement={line.removesOnDecrement}
            canIncrement={line.canIncrement && !atLimit}
            onIncrement={line.increment}
            onDecrement={() => onDecrement(product.id)}
          />
        ) : (
          <button
            type="button"
            onClick={add}
            aria-label={minimum > 1 ? `Ajouter ${minimum} ${product.name} au panier` : `Ajouter ${product.name} au panier`}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border-2 border-[var(--color-primary)] bg-white px-3 text-sm font-bold transition-colors hover:bg-[color-mix(in_srgb,var(--color-primary)_8%,white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1 motion-reduce:transition-none"
            style={{ color: accent }}
          >
            <IconPlus size={16} aria-hidden="true" />
            {minimum > 1 ? `Ajouter ${minimum}` : 'Ajouter'}
          </button>
        )}
      </div>
    </li>
  );
}
