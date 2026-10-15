'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IconArrowRight, IconLoader2, IconPhoto, IconPlus, IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';
import { useQuickAdd } from '@/components/catalog/useQuickAdd';
import { AvailabilityBadge } from '@/components/catalog/AvailabilityBadge';
import { PromoBadge } from '@/components/catalog/PromoBadge';
import { LepefyImage } from '@/components/images/LepefyImage';
import { useProductSuggestions } from '@/components/search/useProductSuggestions';
import { useVirtualKeyboard } from '@/hooks/useVirtualKeyboard';
import { catalogSearchHref } from '@/lib/catalog/catalogSearchUrl';
import { rememberShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { useCartLineQuantity } from '@/lib/cart/useCartLineQuantity';
import { describePrice, formatCount, resolveSellingFormat } from '@/lib/storefrontCopy/sellingFormat';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useTenant } from '@/providers/TenantProvider';
import { accentTextOnWhite } from '@/lib/utils/color';
import { CartStepper } from './CartStepper';

/** Marge entre le bas du panneau de résultats et le clavier ou la barre du bas. */
const PANEL_GAP = 8;
const PANEL_MIN_HEIGHT = 140;

interface CartProductSearchProps {
  currency?: string;
  /** «−» d'un résultat déjà au panier : même chemin que les lignes (retrait au minimum avec annulation). */
  onDecrement: (productId: string) => void;
}

/**
 * Recherche du panier, dans l'en-tête collant (toujours accessible) : le même
 * moteur que la recherche globale (`useProductSuggestions`), avec les noms
 * proches en cas de faute de frappe (« Produits similaires »). Les résultats
 * s'ouvrent dans un panneau sous le champ, limité à la zone visible (au-dessus
 * du clavier ou de la barre du bas). « Ajouter » pose la quantité minimale
 * (`useQuickAdd` → `cartStore.addItem`), puis le résultat montre le même +/−
 * que les lignes. Valider ferme le clavier, jamais une navigation. BottomNav et
 * barre « Livraison et paiement » s'effacent seulement tant que le clavier est
 * ouvert (`useVirtualKeyboard`) ; quand il se referme (retour Android, geste
 * iOS), le champ perd le focus et la navigation revient sans autre geste.
 */
export function CartProductSearch({ currency, onDecrement }: CartProductSearchProps) {
  const id = useId();
  const resultsId = `${id}-results`;
  const rootRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const setSearchActive = useCartUiStore((s) => s.setCartSearchActive);
  const keyboard = useVirtualKeyboard(focused);
  const suggestions = useProductSuggestions(query, true, { similar: true });
  const { searchable, loading, showResults, error, products, similar, total } = suggestions;
  const trimmed = query.trim();
  const panelOpen = open && searchable;
  // Sans `visualViewport`, on retombe sur le focus seul.
  const keyboardOpen = focused && (keyboard.supported ? keyboard.open : true);
  const keyboardWasOpen = useRef(false);

  useEffect(() => { setSearchActive(keyboardOpen); }, [keyboardOpen, setSearchActive]);
  // Quitter la page clavier ouvert ne doit jamais laisser la navigation masquée.
  useEffect(() => () => setSearchActive(false), [setSearchActive]);

  // Clavier refermé sans quitter le champ (retour Android, geste iOS) : le
  // champ perd le focus, la BottomNav revient ; un nouveau toucher le rouvre.
  useEffect(() => {
    if (!focused || !keyboard.supported) { keyboardWasOpen.current = false; return; }
    if (keyboard.open) keyboardWasOpen.current = true;
    else if (keyboardWasOpen.current) {
      keyboardWasOpen.current = false;
      inputRef.current?.blur();
    }
  }, [focused, keyboard.open, keyboard.supported]);

  // Panneau limité à la zone visible : au-dessus du clavier, ou de la barre
  // « Livraison et paiement » / BottomNav quand elles sont affichées.
  const measurePanel = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const viewport = window.visualViewport;
    let bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    document.querySelectorAll<HTMLElement>('[data-bottom-chrome]').forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.height > 0 && rect.top < bottom) bottom = rect.top;
    });
    setPanelMaxHeight(Math.max(PANEL_MIN_HEIGHT, Math.floor(bottom - panel.getBoundingClientRect().top - PANEL_GAP)));
  }, []);

  useLayoutEffect(() => {
    if (!panelOpen) return;
    measurePanel();
    // Les barres du bas réapparaissent au rendu suivant (store) : nouvelle mesure.
    const frame = requestAnimationFrame(measurePanel);
    window.addEventListener('resize', measurePanel);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measurePanel);
    };
  }, [panelOpen, keyboardOpen, keyboard.viewportHeight, showResults, measurePanel]);

  // Toucher ailleurs (lignes du panier, barre) referme le panneau, le texte reste.
  useEffect(() => {
    if (!panelOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [panelOpen]);

  function clear() {
    setQuery('');
    setAnnouncement('');
    inputRef.current?.focus();
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Ferme le clavier : les résultats restent affichés.
    inputRef.current?.blur();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return;
    if (panelOpen) { event.preventDefault(); setOpen(false); return; }
    if (query) { event.preventDefault(); setQuery(''); }
  }

  function rememberSearch() {
    rememberShoppingReturn({ pathname: '/', search: new URLSearchParams({ q: trimmed }).toString() });
  }

  const found = products.length + similar.length;
  const statusMessage = !searchable
    ? announcement
    : loading
      ? 'Recherche en cours…'
      : error
        ? 'La recherche ne répond pas.'
        : showResults
          ? announcement || (found === 0
            ? 'Aucun produit trouvé'
            : products.length === 0
              ? `Aucun résultat exact, ${similar.length} produit${similar.length > 1 ? 's' : ''} similaire${similar.length > 1 ? 's' : ''}`
              : `${found} produit${found > 1 ? 's' : ''} proposé${found > 1 ? 's' : ''}`)
          : '';

  const renderRows = (list: ProductCardProduct[], label: string) => (
    <ul aria-label={label} className="divide-y divide-gray-100">
      {list.map((product) => (
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
  );

  return (
    <section ref={rootRef} aria-label="Ajouter un produit au panier" className="relative">
      <form role="search" onSubmit={handleSubmit} action="/">
        <div className="flex h-12 items-center gap-3 rounded-xl border-[1.5px] border-[color:var(--field-border)] bg-[color:var(--field-bg)] px-3.5 transition-shadow focus-within:border-[var(--color-primary)] focus-within:bg-white focus-within:shadow-[0_0_0_1px_var(--color-primary),0_0_0_5px_var(--field-ring)] motion-reduce:transition-none">
          {loading
            ? <IconLoader2 size={20} className="shrink-0 animate-spin text-gray-600 motion-reduce:animate-none" aria-hidden="true" />
            : <IconSearch size={20} className="shrink-0 text-gray-600" aria-hidden="true" />}
          <input
            ref={inputRef}
            type="search"
            name="q"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setAnnouncement(''); setOpen(true); }}
            onFocus={() => { setFocused(true); setOpen(true); }}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher un produit..."
            aria-label="Rechercher un produit à ajouter au panier"
            aria-controls={panelOpen ? resultsId : undefined}
            aria-expanded={panelOpen}
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

      {panelOpen && (
        <div
          ref={panelRef}
          id={resultsId}
          className="absolute left-0 right-0 top-full z-10 mt-2 overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
          style={{ maxHeight: panelMaxHeight ?? undefined }}
        >
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
          ) : found === 0 ? (
            <div className="px-4 py-3">
              <p className="text-sm font-bold text-gray-900">Aucun produit trouvé</p>
              <p className="mt-0.5 text-sm text-gray-600">Vérifiez l&apos;orthographe ou essayez un autre mot.</p>
            </div>
          ) : (
            <>
              {products.length > 0 && renderRows(products, `Résultats pour « ${trimmed} »`)}
              {total > products.length && (
                <Link href={catalogSearchHref(trimmed)} onClick={rememberSearch}
                  className="flex min-h-12 items-center justify-between border-t border-gray-100 px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]"
                  style={{ color: 'var(--color-primary)' }}>
                  Voir tous les résultats ({total})
                  <IconArrowRight size={18} aria-hidden="true" />
                </Link>
              )}
              {similar.length > 0 && (
                <div className={products.length > 0 ? 'border-t border-gray-200' : undefined}>
                  <p className="px-4 pb-1 pt-3 text-sm font-bold text-gray-900">
                    {products.length === 0 ? <>Aucun résultat exact pour « {trimmed} ». Vouliez-vous dire :</> : 'Produits similaires'}
                  </p>
                  {renderRows(similar, 'Produits similaires')}
                </div>
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
