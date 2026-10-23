'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, useEffect } from 'react';
import { ProductGrid, ProductCardSkeleton } from '@/components/catalog/ProductGrid';
import { ProductCard } from '@/components/catalog/ProductCard';
import { CatalogCategoryRow } from '@/components/catalog/CatalogCategoryRow';
import { semanticMatchToProductCardProduct } from '@/lib/catalog/productCardAdapters';
import { buildCatalogUrl, CATALOG_NOVELTIES_HREF, CATALOG_PROMOS_HREF, type CatalogUrlOverrides } from '@/lib/catalog/catalogSearchUrl';
import { CatalogShelf } from '@/components/catalog/CatalogShelf';
import { recordAddSource } from '@/lib/cart/recordAddSource';
import { IconLayoutGrid } from '@tabler/icons-react';

const SEE_ALL_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 motion-reduce:transition-none';
import { rememberCatalogPosition, takeCatalogScrollRestore } from '@/lib/catalog/shoppingReturn';
import { useCatalogSearchStore } from '@/stores/catalogSearchStore';
import { useInfiniteProducts } from '@/lib/catalog/useInfiniteProducts';
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
  /** `?promo=1` : la grille montre toutes les promotions actives. */
  promoView?: boolean;
  /** Promotions actives et achetables du tenant (0 = aucun accès promo affiché). */
  promoCount?: number;
  /** Section « Nos promos » du catalogue non filtré (vide = masquée). */
  promoShelf?: ProductWithCategory[];
  /** `?new=1` : la grille montre toutes les nouveautés actives. */
  noveltyView?: boolean;
  /** Nouveautés actives et achetables du tenant. */
  noveltyCount?: number;
  /** Bloc « Nouveautés » du catalogue non filtré (vide = masqué). */
  noveltyShelf?: ProductWithCategory[];
  /** « Les petits plus » de la boutique (catalogue non filtré). */
  addOnShelf?: ProductWithCategory[];
  /** Produits déjà montrés dans les blocs : exclus des pages suivantes aussi. */
  excludeIds?: string[];
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
  promoView = false,
  promoCount = 0,
  promoShelf = [],
  noveltyView = false,
  noveltyCount = 0,
  noveltyShelf = [],
  addOnShelf = [],
  excludeIds = [],
}: Props) {
  const pathname      = usePathname();
  const router        = useRouter();
  const searchParams  = useSearchParams();
  const [isNavigating, startTransition] = useTransition();
  // Le champ de recherche vit dans le layout (GlobalProductSearch) : sa
  // transition affiche le même squelette que les changements de filtre.
  const searchPending = useCatalogSearchStore((s) => s.pending);
  const isPending = isNavigating || searchPending;

  const [semanticResults, setSemanticResults]     = useState<SemanticMatch[]>([]);
  const [isSemanticLoading, setIsSemanticLoading] = useState(false);

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

  function buildUrl(overrides: CatalogUrlOverrides) {
    return buildCatalogUrl(pathname, searchParams.toString(), overrides);
  }

  // Scroll infini (hook partagé avec le panier) : la liste repart du rendu
  // serveur à chaque recherche/catégorie, ou sur une URL ?page=N directe.
  const {
    items, page, hasMore, isLoadingMore, loadMoreFailed, loadMore: handleLoadMore, sentinelRef,
  } = useInfiniteProducts<ProductWithCategory>({
    initialItems: products,
    initialPage: currentPage,
    initialHasMore: hasNextPage,
    // En pause pendant une transition de filtre : la grille va être remplacée.
    autoLoad: !isPending,
    // La page suivante part ~2 écrans avant la fin de la grille.
    rootMargin: '0px 0px 1200px 0px',
    buildParams: () => {
      const params = new URLSearchParams();
      params.set('day', rankingDay);
      if (sort !== 'recommended') params.set('sort', sort);
      if (quantityGroupId) params.set('quantityGroup', quantityGroupId);
      if (excludeIds.length > 0) params.set('exclude', excludeIds.join(','));
      const trimmedQuery = initialQuery.trim();
      if (trimmedQuery) params.set('q', trimmedQuery);
      else if (activeSlug) params.set('category', activeSlug);
      return params;
    },
    // Met à jour l'URL affichée (deep-link/partage) sans router.replace() :
    // celui-ci re-exécuterait le Server Component et re-fetcherait tout le
    // cumul déjà chargé en léger. ?page= n'est consulté par le serveur que sur
    // une vraie navigation (lien direct, partage, retour arrière).
    onPageLoaded: (nextPage) => {
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.set('page', String(nextPage));
      urlParams.set('day', rankingDay);
      window.history.replaceState(null, '', `${window.location.pathname}?${urlParams.toString()}`);
    },
  });

  const textualIds = new Set(items.map(p => p.id));
  const semanticOnly = semanticResults.filter(p => !textualIds.has(p.id));

  // Retour depuis le panier ou une fiche : même URL (?page=N cumulatif) donc
  // même liste, la position enregistrée pointe sur les mêmes produits.
  useEffect(() => {
    const y = takeCatalogScrollRestore(window.location);
    if (y == null) return;
    // Après le rendu de la liste. Jamais annulé au démontage : la position est
    // consommée une seule fois (un double montage en développement la perdrait).
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
  }, []);

  // URL et position du catalogue affiché, pour « Continuer mes achats » —
  // même quand le panier est ouvert depuis la barre du bas.
  const searchKey = searchParams.toString();
  useEffect(() => {
    rememberCatalogPosition(window.location, window.scrollY);
    let pending = false;
    function onScroll() {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        rememberCatalogPosition(window.location, window.scrollY);
      }, 250);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [searchKey, page]);

  function clearSearch() {
    startTransition(() => {
      router.replace(buildUrl({ q: '' }));
    });
  }

  function leaveSpecialView() {
    startTransition(() => {
      router.push(buildUrl(promoView ? { promo: false } : { novelty: false }));
    });
  }

  function handleCategorySelect(slug: string | null) {
    startTransition(() => {
      router.push(buildUrl({ q: '', category: slug }));
    });
  }

  const hasActiveSearch = initialQuery.trim().length > 0;
  const activeCategory = categories.find(category => category.slug === activeSlug);
  const productHeading = hasActiveSearch
    ? `Résultats pour “${initialQuery}”`
    : promoView ? '🔥 Nos promos'
    : noveltyView ? '✨ Nouveautés'
    : quantityGroupName ? `Compléter : ${quantityGroupName}` : activeCategory?.name ?? 'Tous les produits';
  const specialView = promoView || noveltyView;
  const availableLabel = `${totalCount} produit${totalCount === 1 ? '' : 's'} disponible${totalCount === 1 ? '' : 's'}`;

  return (
    <div className="max-w-6xl mx-auto px-4 pb-6 md:pb-8">
      {/* La recherche est le champ global juste au-dessus (layout boutique). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-4 md:pt-6">
        <h1 className="font-display text-2xl font-bold text-gray-900">Catalogue</h1>
        {specialView && (
          <button
            type="button"
            onClick={leaveSpecialView}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-extrabold text-white shadow-sm hover:opacity-90 ${SEE_ALL_FOCUS}`}
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <IconLayoutGrid size={18} aria-hidden="true" /> Voir tout le catalogue
          </button>
        )}
      </div>

      {/* Visual category navigation — hidden during textual search. */}
      {!hasActiveSearch && (
        <CatalogCategoryRow categories={categories} previewImagesByCategory={previewImagesByCategory} activeSlug={activeSlug} onSelect={handleCategorySelect} />
      )}

      {/* Catalogue non filtré : blocs Promos puis Nouveautés, chacun avec « Tout voir ».
          Leurs produits sont exclus de « Tous les produits » (excludeIds). */}
      <CatalogShelf id="promo-shelf" title="Nos promos" icon="🔥" tone="promo" href={CATALOG_PROMOS_HREF}
        count={promoCount} allLabel="Tout voir les promos" products={promoShelf} />
      <CatalogShelf id="novelty-shelf" title="Nouveautés" icon="✨" tone="novelty" href={CATALOG_NOVELTIES_HREF}
        count={noveltyCount} allLabel="Tout voir les nouveautés" products={noveltyShelf} />
      <CatalogShelf id="add-ons-shelf" title="Les petits plus" icon="🛒" tone="novelty" products={addOnShelf}
        onAdded={(product) => recordAddSource(product.id, 'catalog_shelf')} />

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
          {promoView && totalCount > 0 && (
            <p className="mt-1 text-sm text-gray-600">{totalCount} produit{totalCount === 1 ? '' : 's'} en promotion</p>
          )}
          {noveltyView && totalCount > 0 && (
            <p className="mt-1 text-sm text-gray-600">{totalCount} nouveauté{totalCount === 1 ? '' : 's'}</p>
          )}
        </div>
        {hasActiveSearch && (
          <button
            type="button"
            onClick={clearSearch}
            className="min-h-11 text-sm font-medium"
            style={{ color: 'var(--color-primary)' }}
          >
            Effacer la recherche
          </button>
        )}
        {!specialView && <label className="ml-auto flex shrink-0 flex-col gap-1 text-xs font-medium text-gray-600 sm:flex-row sm:items-center sm:gap-2">
          <span className="sr-only sm:not-sr-only">Trier par</span>
          <select
            value={sort}
            onChange={e => startTransition(() => router.replace(buildUrl({ sort: e.target.value as CatalogSort })))}
            className="min-h-11 max-w-[155px] rounded-lg border-[1.5px] border-[color:var(--field-border)] bg-white px-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:max-w-none"
            aria-label="Trier les produits"
          >
            <option value="recommended">Recommandés</option>
            <option value="bestsellers">Meilleures ventes</option>
            <option value="newest">Derniers ajoutés</option>
            <option value="price_asc">Prix croissant</option>
            <option value="price_desc">Prix décroissant</option>
          </select>
        </label>}
      </div>

      {specialView && totalCount === 0 && !isPending && (
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-8 text-center" role="status">
          <p className="font-semibold text-gray-900">{promoView ? 'Aucune promotion en ce moment.' : 'Aucune nouveauté en ce moment.'}</p>
          <p className="mt-1 text-sm text-gray-600">Revenez bientôt, ou parcourez tout le catalogue.</p>
          <button type="button" onClick={leaveSpecialView}
            className="mt-4 inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            Voir tout le catalogue
          </button>
        </div>
      )}

      {/* Griglia */}
      {!(specialView && totalCount === 0 && !isPending) && <ProductGrid products={items} loading={isPending} />}

      {/* Fin des vues « Nos promos » / « Nouveautés » : retour bien visible au catalogue complet. */}
      {specialView && totalCount > 0 && !isPending && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={leaveSpecialView}
            className={`inline-flex min-h-[52px] w-full max-w-sm items-center justify-center gap-2 rounded-2xl px-6 text-base font-extrabold text-white shadow-sm hover:opacity-90 ${SEE_ALL_FOCUS}`}
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <IconLayoutGrid size={20} aria-hidden="true" /> Voir tout le catalogue
          </button>
        </div>
      )}

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
          <svg className="animate-spin shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
