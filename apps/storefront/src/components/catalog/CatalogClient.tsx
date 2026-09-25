'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, useEffect, useRef } from 'react';
import { ProductGrid, ProductCardSkeleton } from '@/components/catalog/ProductGrid';
import { ProductCard } from '@/components/catalog/ProductCard';
import { CatalogCategoryRow } from '@/components/catalog/CatalogCategoryRow';
import { semanticMatchToProductCardProduct } from '@/lib/catalog/productCardAdapters';
import type { Category, ProductWithCategory, SemanticMatch } from '@lepefy/types';
import type { CatalogSort } from '@/lib/catalog/pagination';

interface Props {
  categories:      Category[];
  previewImagesByCategory: Record<string, string[]>;
  products:        ProductWithCategory[];
  activeSlug?:     string;
  initialQuery:    string;
  semanticEnabled: boolean;
  totalCount:      number;
  currentPage:     number;
  hasNextPage:     boolean;
  sort:            CatalogSort;
  rankingDay:      string;
  quantityGroupId?: string;
  quantityGroupName?: string;
}

export function CatalogClient({
  categories,
  previewImagesByCategory,
  products,
  activeSlug,
  initialQuery,
  semanticEnabled,
  totalCount,
  currentPage,
  hasNextPage,
  sort,
  rankingDay,
  quantityGroupId,
  quantityGroupName,
}: Props) {
  const pathname      = usePathname();
  const router        = useRouter();
  const searchParams  = useSearchParams();
  const [query, setQuery]            = useState(initialQuery);
  const [isPending, startTransition] = useTransition();
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Accumulation des pages chargées par le scroll infini — remise à zéro
  // chaque fois qu'un nouveau rendu serveur arrive (recherche/catégorie
  // changée, ou chargement direct d'une URL ?page=N).
  const [items, setItems]             = useState<ProductWithCategory[]>(products);
  const [page, setPage]               = useState(currentPage);
  const [hasMore, setHasMore]         = useState(hasNextPage);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const sentinelRef    = useRef<HTMLDivElement | null>(null);
  // Garde synchrone : l'observer peut notifier deux fois avant que
  // setIsLoadingMore n'ait re-rendu le composant.
  const loadingMoreRef = useRef(false);
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  const [semanticResults, setSemanticResults]     = useState<SemanticMatch[]>([]);
  const [isSemanticLoading, setIsSemanticLoading] = useState(false);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    // Une page suivante encore en vol appartient à l'ancien filtre : elle ne
    // doit jamais être ajoutée à la nouvelle liste.
    loadMoreAbortRef.current?.abort();
    setItems(products);
    setPage(currentPage);
    setHasMore(hasNextPage);
    setLoadMoreFailed(false);
  }, [products, currentPage, hasNextPage]);

  // Cascade : la recherche sémantique ne se déclenche que si la recherche
  // textuelle existante donne peu de résultats au total — elle ne la
  // remplace jamais. `totalCount` (pas `items.length`) car le seuil doit
  // porter sur le nombre réel de résultats, pas sur ce qui est déjà chargé.
  useEffect(() => {
    const trimmed = initialQuery.trim();
    if (!semanticEnabled || !trimmed || totalCount >= 3) {
      setSemanticResults([]);
      setIsSemanticLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsSemanticLoading(true);

    fetch(`/api/search/semantic?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : { results: [] }))
      .then((data: { results?: SemanticMatch[] }) => {
        setSemanticResults(data.results ?? []);
      })
      .catch(() => {
        // Dégradation silencieuse : rate limit, erreur réseau ou feature
        // désactivée ne doivent jamais être visibles côté client.
        setSemanticResults([]);
      })
      .finally(() => setIsSemanticLoading(false));

    return () => controller.abort();
  }, [initialQuery, totalCount, semanticEnabled]);

  const textualIds = new Set(items.map(p => p.id));
  const semanticOnly = semanticResults.filter(p => !textualIds.has(p.id));

  function buildUrl(overrides: { q?: string; category?: string | null; sort?: CatalogSort }) {
    const params = new URLSearchParams(searchParams.toString());
    const newQ = overrides.q !== undefined ? overrides.q : query;
    if (newQ.trim()) params.set('q', newQ.trim());
    else params.delete('q');
    if (overrides.category !== undefined) {
      if (overrides.category) params.set('category', overrides.category);
      else params.delete('category');
      params.delete('quantityGroup');
    }
    if (overrides.sort !== undefined) {
      if (overrides.sort === 'recommended') params.delete('sort');
      else params.set('sort', overrides.sort);
    }
    // A new filter/sort starts with today's daily ranking.
    params.delete('day');
    // Changer de filtre repart toujours de la page 1 — jamais de ?page=
    // résiduel d'une navigation précédente.
    params.delete('page');
    const qs = params.toString();
    return `${pathname}${qs ? '?' + qs : ''}`;
  }

  async function handleLoadMore() {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setIsLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const nextPage = page + 1;
      const params = new URLSearchParams();
      params.set('page', String(nextPage));
      params.set('day', rankingDay);
      if (sort !== 'recommended') params.set('sort', sort);
      if (quantityGroupId) params.set('quantityGroup', quantityGroupId);
      const trimmedQuery = initialQuery.trim();
      if (trimmedQuery) params.set('q', trimmedQuery);
      else if (activeSlug) params.set('category', activeSlug);

      const res = await fetch(`/api/products?${params.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { products?: ProductWithCategory[]; hasNextPage?: boolean } = await res.json();
      if (controller.signal.aborted) return;

      // Dédoublonnage défensif : le classement "recommandé" peut bouger entre
      // deux pages (stock épuisé entre-temps) et renvoyer un produit déjà affiché.
      setItems(prev => {
        const seen = new Set(prev.map(p => p.id));
        return [...prev, ...(data.products ?? []).filter(p => !seen.has(p.id))];
      });
      setPage(nextPage);
      setHasMore(Boolean(data.hasNextPage));

      // Met à jour l'URL affichée (deep-link/partage) sans passer par
      // router.replace() : celui-ci re-exécuterait le Server Component du
      // Catalogue et re-fetcherait tout le cumul qu'on vient de charger en
      // léger via /api/products — on perdrait tout le bénéfice du fetch
      // incrémental. On garde donc l'historique intact (pas de nouvelle
      // entrée par clic) ; ?page= n'est réellement consulté par le serveur
      // que sur une vraie navigation (lien direct, partage, retour arrière).
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.set('page', String(nextPage));
      urlParams.set('day', rankingDay);
      window.history.replaceState(null, '', `${window.location.pathname}?${urlParams.toString()}`);
    } catch {
      // Le sentinel reste visible sans nouvelle intersection : sans bouton
      // "Réessayer", un échec réseau bloquerait le scroll infini.
      if (!controller.signal.aborted) setLoadMoreFailed(true);
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadingMoreRef.current = false;
        loadMoreAbortRef.current = null;
        setIsLoadingMore(false);
      }
    }
  }

  // Toujours la dernière version de handleLoadMore (page/filtres courants)
  // sans ré-abonner l'observer à chaque rendu.
  const loadMoreRef = useRef(handleLoadMore);
  loadMoreRef.current = handleLoadMore;

  // Scroll infini : la page suivante part ~2 écrans avant la fin de la grille,
  // pour qu'elle soit en général déjà affichée quand l'utilisateur y arrive.
  const autoLoadEnabled = hasMore && !isPending && !loadMoreFailed;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!autoLoadEnabled || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => { if (entries.some(entry => entry.isIntersecting)) void loadMoreRef.current(); },
      { rootMargin: '0px 0px 1200px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // `items.length` ré-arme l'observer après chaque page : si le sentinel est
    // toujours dans la zone (écran haut, page courte), on enchaîne la suivante.
  }, [autoLoadEnabled, items.length]);

  useEffect(() => () => loadMoreAbortRef.current?.abort(), []);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(() => {
        router.replace(buildUrl({ q: value }));
      });
    }, 300);
  }

  function handleCategorySelect(slug: string | null) {
    setQuery('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    startTransition(() => {
      router.push(buildUrl({ q: '', category: slug }));
    });
  }

  const hasActiveSearch = initialQuery.trim().length > 0;
  const activeCategory = categories.find(category => category.slug === activeSlug);
  const productHeading = hasActiveSearch
    ? `Résultats pour “${initialQuery}”`
    : quantityGroupName ? `Compléter : ${quantityGroupName}` : activeCategory?.name ?? 'Tous les produits';
  const availableLabel = `${totalCount} produit${totalCount === 1 ? '' : 's'} disponible${totalCount === 1 ? '' : 's'}`;

  return (
    <div className="max-w-6xl mx-auto px-4 pb-6 md:pb-8">
      <h1 className="sr-only">Catalogue</h1>
      {/* Search bar */}
      <div className="sticky top-24 z-30 -mx-4 bg-white/95 px-4 py-2 backdrop-blur">
        <div className="flex h-[52px] max-w-2xl items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 shadow-sm transition-shadow focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-[var(--color-primary)]/20">
        {isPending ? (
          <svg
            className="shrink-0 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="#9ca3af" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        ) : (
          <svg
            className="shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="#9ca3af" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
            <path d="M21 21l-6 -6" />
          </svg>
        )}
        <input
          type="search"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          placeholder="Rechercher un produit..."
          className="min-w-0 flex-1 bg-transparent text-base text-gray-700
                     placeholder:text-gray-400 outline-none border-none"
          aria-label="Rechercher un produit"
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
        />
        {query && (
          <button
            type="button"
            onClick={() => handleQueryChange('')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2"
            aria-label="Effacer la recherche"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
              <path d="M18 6l-12 12" /><path d="M6 6l12 12" />
            </svg>
          </button>
        )}
        </div>
      </div>

      {/* Visual category navigation — hidden during textual search. */}
      {!hasActiveSearch && (
        <CatalogCategoryRow categories={categories} previewImagesByCategory={previewImagesByCategory} activeSlug={activeSlug} onSelect={handleCategorySelect} />
      )}

      {quantityGroupId && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
          <p>Choisissez les produits à combiner dans « {quantityGroupName ?? 'ce groupe'} ».</p>
          <button type="button" onClick={() => router.push('/')} className="min-h-11 shrink-0 font-bold underline">
            Tous les produits
          </button>
        </div>
      )}

      {/* Résultats et tri */}
      <div className="mt-4 mb-4 flex items-end justify-between gap-3 md:mt-6">
        <div>
          <h2 className="font-display text-xl font-bold text-gray-900">{productHeading}</h2>
          {hasActiveSearch && <p className="mt-1 text-sm text-gray-500">{availableLabel}</p>}
        </div>
        {hasActiveSearch && (
          <button
            onClick={() => handleQueryChange('')}
            className="text-sm font-medium"
            style={{ color: 'var(--color-primary)' }}
          >
            Effacer
          </button>
        )}
        <label className="ml-auto flex shrink-0 flex-col gap-1 text-xs font-medium text-gray-600 sm:flex-row sm:items-center sm:gap-2">
          <span className="sr-only sm:not-sr-only">Trier par</span>
          <select
            value={sort}
            onChange={e => startTransition(() => router.replace(buildUrl({ sort: e.target.value as CatalogSort })))}
            className="min-h-11 max-w-[155px] rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:max-w-none"
            aria-label="Trier les produits"
          >
            <option value="recommended">Recommandés</option>
            <option value="bestsellers">Meilleures ventes</option>
            <option value="newest">Nouveautés</option>
            <option value="price_asc">Prix croissant</option>
            <option value="price_desc">Prix décroissant</option>
          </select>
        </label>
      </div>

      {/* Griglia */}
      <ProductGrid products={items} loading={isPending} />

      {/* Scroll infini — pagination server-side déclenchée par le sentinel.
          Masqué pendant une transition de filtre (isPending) : la grille va
          être remplacée par le skeleton. */}
      {!isPending && hasMore && (
        <>
          {isLoadingMore && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:mt-4 md:gap-4 lg:grid-cols-4" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)}
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {isLoadingMore ? 'Chargement de produits supplémentaires…' : ''}
          </p>
          {loadMoreFailed && (
            <div className="mt-6 flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-gray-500">Impossible de charger la suite du catalogue.</p>
              <button
                type="button"
                onClick={() => void handleLoadMore()}
                className="min-h-11 rounded-full border border-gray-200 px-6 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Réessayer
              </button>
            </div>
          )}
          <div ref={sentinelRef} className="h-px" aria-hidden="true" />
        </>
      )}
      {!isPending && !hasMore && page > 1 && (
        <p className="mt-8 text-center text-sm text-gray-400">Vous avez vu tous les produits.</p>
      )}

      {/* Résultats similaires — recherche sémantique, cascade uniquement si peu de résultats textuels */}
      {isSemanticLoading && (
        <div className="mt-8 flex items-center gap-2 text-sm text-gray-400">
          <svg className="animate-spin shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
          Recherche de produits similaires...
        </div>
      )}
      {!isSemanticLoading && semanticOnly.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Résultats similaires</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
            {semanticOnly.map(product => (
              <ProductCard key={product.id} product={semanticMatchToProductCardProduct(product)} compactMobile />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
