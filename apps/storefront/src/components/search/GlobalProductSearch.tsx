'use client';

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { IconArrowRight, IconLoader2, IconPhoto, IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';
import { PromoBadge } from '@/components/catalog/PromoBadge';
import { AvailabilityBadge } from '@/components/catalog/AvailabilityBadge';
import { LepefyImage } from '@/components/images/LepefyImage';
import { useTenant } from '@/providers/TenantProvider';
import { buildCatalogUrl, catalogSearchHref } from '@/lib/catalog/catalogSearchUrl';
import { rememberShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { isCatalogSearchPath } from '@/lib/storefront/shopChrome';
import { deriveAvailability } from '@/lib/storefrontCopy/availability';
import { describePrice, resolveSellingFormat } from '@/lib/storefrontCopy/sellingFormat';
import { useCatalogSearchStore } from '@/stores/catalogSearchStore';

const MIN_QUERY_LENGTH = 2;
const SUGGESTION_LIMIT = 5;
const SUGGEST_DEBOUNCE_MS = 250;
const CATALOG_DEBOUNCE_MS = 300;
const CACHE_SIZE = 20;

type Suggestions = { products: ProductCardProduct[]; total: number };
type Status = 'idle' | 'loading' | 'ready' | 'error';

// Partagé par les instances (barre mobile, header desktop) pendant la visite :
// effacer une lettre ou revenir sur un mot déjà tapé ne relance pas la requête.
const suggestionCache = new Map<string, Suggestions>();

function cacheKey(query: string): string {
  return query.trim().toLowerCase();
}

function remember(key: string, value: Suggestions) {
  suggestionCache.delete(key);
  suggestionCache.set(key, value);
  if (suggestionCache.size > CACHE_SIZE) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest !== undefined) suggestionCache.delete(oldest);
  }
}

interface Props {
  /** `bar` = barre sous l'header (mobile/tablette) ; `header` = champ intégré à l'header desktop. */
  variant: 'bar' | 'header';
}

/**
 * Champ de recherche unique de la boutique. Sur le Catalogue il filtre la
 * grille via `?q=` (même comportement qu'avant, une seule saisie à l'écran) ;
 * ailleurs il propose quelques produits du tenant via `/api/products` et mène
 * aux résultats complets. Aucune requête avant que le client écrive.
 */
export function GlobalProductSearch({ variant }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const catalogMode = isCatalogSearchPath(pathname);
  const urlQuery = catalogMode ? searchParams.get('q') ?? '' : '';

  const id = useId();
  const listboxId = `${id}-suggestions`;
  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(urlQuery);

  // ── Mode Catalogue : la recherche pilote l'URL ───────────────────────────
  const [isPending, startTransition] = useTransition();
  const catalogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<string | null>(null);
  const setCatalogPending = useCatalogSearchStore((s) => s.setPending);

  useEffect(() => {
    if (catalogMode) setCatalogPending(isPending);
  }, [catalogMode, isPending, setCatalogPending]);

  useEffect(() => {
    if (!catalogMode) return;
    // Écho de notre propre saisie : ne jamais écraser ce que le client tape encore.
    if (urlQuery === lastSentRef.current) return;
    lastSentRef.current = urlQuery;
    setQuery(urlQuery);
  }, [catalogMode, urlQuery]);

  const sendCatalogQuery = useCallback((value: string) => {
    if (catalogTimer.current) clearTimeout(catalogTimer.current);
    lastSentRef.current = value.trim();
    startTransition(() => {
      router.replace(buildCatalogUrl('/', window.location.search, { q: value }));
    });
  }, [router]);

  // ── Mode propositions ─────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<Suggestions>({ products: [], total: 0 });
  const [activeIndex, setActiveIndex] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  const trimmed = query.trim();
  const searchable = trimmed.length >= MIN_QUERY_LENGTH;

  // Changement de page : on repart d'un champ vide (hors Catalogue) et fermé.
  useEffect(() => {
    setOpen(false);
    setActiveIndex(-1);
    if (!isCatalogSearchPath(pathname)) {
      setQuery('');
      setDebounced('');
      // Au retour sur le Catalogue, le champ reprend la recherche de l'URL.
      lastSentRef.current = null;
    }
  }, [pathname]);

  useEffect(() => {
    if (catalogMode) return;
    const timer = setTimeout(() => setDebounced(trimmed), SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [catalogMode, trimmed]);

  useEffect(() => {
    if (catalogMode) return;
    if (debounced.length < MIN_QUERY_LENGTH) {
      setStatus('idle');
      setResult({ products: [], total: 0 });
      return;
    }
    const key = cacheKey(debounced);
    const cached = suggestionCache.get(key);
    if (cached) {
      setResult(cached);
      setStatus('ready');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    const params = new URLSearchParams({ q: debounced, limit: String(SUGGESTION_LIMIT) });
    fetch(`/api/products?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { products?: ProductCardProduct[]; totalCount?: number };
        const value = { products: (data.products ?? []).slice(0, SUGGESTION_LIMIT), total: data.totalCount ?? 0 };
        remember(key, value);
        setResult(value);
        setStatus('ready');
        setActiveIndex(-1);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [catalogMode, debounced, attempt]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => () => { if (catalogTimer.current) clearTimeout(catalogTimer.current); }, []);

  // Les propositions affichées correspondent toujours au texte du champ.
  const settled = debounced === trimmed;
  const showResults = searchable && settled && status === 'ready';
  const products = showResults ? result.products : [];
  const optionCount = showResults ? products.length + 1 : 0; // + « Voir tous les résultats »
  const loading = catalogMode ? isPending : searchable && (!settled || status === 'loading');
  const panelOpen = !catalogMode && open;

  function handleChange(value: string) {
    setQuery(value);
    if (catalogMode) {
      if (catalogTimer.current) clearTimeout(catalogTimer.current);
      catalogTimer.current = setTimeout(() => sendCatalogQuery(value), CATALOG_DEBOUNCE_MS);
      return;
    }
    setOpen(true);
    setActiveIndex(-1);
  }

  function clear() {
    if (catalogMode) {
      setQuery('');
      sendCatalogQuery('');
    } else {
      setQuery('');
      setDebounced('');
      setOpen(true);
    }
    inputRef.current?.focus();
  }

  function closePanel() {
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  }

  function rememberSearch() {
    rememberShoppingReturn({ pathname: '/', search: new URLSearchParams({ q: trimmed }).toString() });
  }

  function showAllResults() {
    if (!trimmed) return;
    closePanel();
    router.push(catalogSearchHref(trimmed));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (catalogMode) {
      sendCatalogQuery(query);
      inputRef.current?.blur();
      return;
    }
    const activeProduct = activeIndex >= 0 ? products[activeIndex] : undefined;
    if (activeProduct) {
      rememberSearch();
      closePanel();
      router.push(`/products/${activeProduct.slug}`);
      return;
    }
    if (searchable) showAllResults();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (catalogMode) return;
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); setOpen(false); setActiveIndex(-1); }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!optionCount) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        if (event.key === 'ArrowDown') return current + 1 >= optionCount ? 0 : current + 1;
        return current <= 0 ? optionCount - 1 : current - 1;
      });
    }
  }

  const header = variant === 'header';
  const fieldClass = header
    ? 'h-11 rounded-xl px-3'
    : 'h-[52px] rounded-xl px-4';
  const statusMessage = catalogMode || !panelOpen || !searchable
    ? ''
    : loading
      ? 'Recherche en cours…'
      : status === 'error'
        ? 'La recherche ne répond pas.'
        : products.length === 0
          ? 'Aucun produit trouvé'
          : `${products.length} produit${products.length > 1 ? 's' : ''} proposé${products.length > 1 ? 's' : ''}`;

  return (
    <form ref={rootRef} role="search" onSubmit={handleSubmit} className="relative w-full" action="/">
      <div className={`flex items-center gap-3 border-[1.5px] border-[color:var(--field-border)] bg-[color:var(--field-bg)] transition-shadow focus-within:border-[var(--color-primary)] focus-within:bg-white focus-within:shadow-[0_0_0_1px_var(--color-primary),0_0_0_5px_var(--field-ring)] motion-reduce:transition-none ${fieldClass}`}>
        {loading
          ? <IconLoader2 size={20} className="shrink-0 animate-spin text-gray-600 motion-reduce:animate-none" aria-hidden="true" />
          : <IconSearch size={20} className="shrink-0 text-gray-600" aria-hidden="true" />}
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (!catalogMode) setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Rechercher un produit..."
          aria-label="Rechercher un produit"
          autoComplete="off"
          enterKeyHint="search"
          className="min-w-0 flex-1 border-none bg-transparent text-base text-gray-950 outline-none placeholder:text-[color:var(--field-placeholder)] focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
          {...(catalogMode ? {} : {
            role: 'combobox',
            'aria-expanded': panelOpen,
            'aria-controls': listboxId,
            'aria-autocomplete': 'list' as const,
            'aria-activedescendant': panelOpen && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined,
          })}
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Effacer la recherche"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <IconX size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">{statusMessage}</p>

      {panelOpen && (
        <div
          className={`absolute left-0 right-0 z-50 mt-1.5 overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)] ${header ? 'max-h-[min(70vh,480px)]' : 'max-h-[min(60dvh,440px)]'}`}
        >
          {!searchable ? (
            <div className="px-4 py-3">
              <p className="text-base font-bold text-gray-900">Que cherchez-vous ?</p>
              <p className="mt-0.5 text-sm text-gray-600">Écrivez au moins 2 lettres, par exemple « riz » ou « piment ».</p>
            </div>
          ) : loading ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-gray-700">
              <IconLoader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Recherche en cours…
            </p>
          ) : status === 'error' ? (
            <div className="px-4 py-3">
              <p className="text-sm font-bold text-gray-900">La recherche ne répond pas.</p>
              <p className="mt-0.5 text-sm text-gray-600">Vérifiez votre connexion.</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)}
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold underline underline-offset-2" style={{ color: 'var(--color-primary)' }}>
                <IconRefresh size={16} aria-hidden="true" />Réessayer
              </button>
            </div>
          ) : (
            <ul id={listboxId} role="listbox" aria-label="Produits proposés" className="py-1">
              {products.length === 0 && (
                <li role="presentation" className="px-4 py-3">
                  <p className="text-sm font-bold text-gray-900">Aucun produit trouvé</p>
                  <p className="mt-0.5 text-sm text-gray-600">Vérifiez l&apos;orthographe ou essayez un autre mot.</p>
                </li>
              )}
              {products.map((product, index) => (
                <SuggestionRow
                  key={product.id}
                  id={`${id}-option-${index}`}
                  product={product}
                  active={index === activeIndex}
                  onSelect={() => { rememberSearch(); closePanel(); }}
                />
              ))}
              <li
                id={`${id}-option-${products.length}`}
                role="option"
                aria-selected={activeIndex === products.length}
                className={`border-t border-gray-100 ${activeIndex === products.length ? 'bg-gray-50' : ''}`}
              >
                {products.length === 0 ? (
                  <Link href="/" onClick={closePanel} tabIndex={-1}
                    className="flex min-h-12 items-center justify-between px-4 text-sm font-bold" style={{ color: 'var(--color-primary)' }}>
                    Voir tout le catalogue <IconArrowRight size={18} aria-hidden="true" />
                  </Link>
                ) : (
                  <Link href={catalogSearchHref(trimmed)} onClick={closePanel} tabIndex={-1}
                    className="flex min-h-12 items-center justify-between px-4 text-sm font-bold" style={{ color: 'var(--color-primary)' }}>
                    {result.total > products.length ? `Voir tous les résultats (${result.total})` : 'Voir tous les résultats'}
                    <IconArrowRight size={18} aria-hidden="true" />
                  </Link>
                )}
              </li>
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

function SuggestionRow({ id, product, active, onSelect }: {
  id: string;
  product: ProductCardProduct;
  active: boolean;
  onSelect: () => void;
}) {
  const { currency } = useTenant();
  const price = describePrice(product.price, resolveSellingFormat(product), currency);
  const minimum = product.min_order_quantity ?? 1;
  const availability = deriveAvailability({ stock: product.stock, minimum, step: product.order_quantity_step });
  const unavailable = availability === 'sold_out' || availability === 'below_minimum';

  return (
    <li id={id} role="option" aria-selected={active} className={active ? 'bg-gray-50' : undefined}>
      <Link href={`/products/${product.slug}`} onClick={onSelect} tabIndex={-1}
        className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-gray-50">
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-gray-50">
          {product.image_url
            ? <LepefyImage src={product.image_url} variant="thumbnail" alt="" fill sizes="44px" className="object-contain" />
            : <IconPhoto size={22} aria-hidden="true" className="absolute inset-0 m-auto text-gray-300" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-5 text-gray-900 line-clamp-2">{product.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-900">
            <span><span className="font-bold">{price.amount}</span> <span className="text-xs font-medium text-gray-700">{price.unitPhrase}</span></span>
            {!unavailable && <PromoBadge product={product} size="sm" />}
            {unavailable
              ? <AvailabilityBadge state={availability} />
              : minimum > 1 && (
                <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-900">{minimum} minimum</span>
              )}
          </span>
        </span>
      </Link>
    </li>
  );
}
