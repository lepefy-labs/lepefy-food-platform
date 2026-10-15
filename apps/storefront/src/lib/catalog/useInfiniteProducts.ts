'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ProductPage<T> {
  products?: T[];
  hasNextPage?: boolean;
}

export interface InfiniteProductsOptions<T extends { id: string }> {
  /** Produits déjà affichés (rendu serveur), page correspondante et suite éventuelle. */
  initialItems: T[];
  initialPage: number;
  initialHasMore: boolean;
  /** Paramètres `/api/products` d'une page donnée (filtres, tri, exclusions, `limit`). */
  buildParams: (page: number) => URLSearchParams;
  /** Chargement automatique au défilement (sentinel proche) ; faux = en pause. */
  autoLoad?: boolean;
  /** Avance de chargement sous le viewport. */
  rootMargin?: string;
  /** Appelé après chaque page ajoutée (ex. URL `?page=N` du catalogue). */
  onPageLoaded?: (page: number) => void;
}

export interface InfiniteProductsState<T> {
  items: T[];
  page: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreFailed: boolean;
  /** Page suivante (bouton « Réessayer », ou appel direct). */
  loadMore: () => Promise<void>;
  /** À poser sur l'élément sentinel placé après la grille. */
  sentinelRef: (node: HTMLElement | null) => void;
  /** Repart d'une nouvelle liste (filtre changé, restauration) ; annule la page en vol. */
  reset: (items: T[], page: number, hasMore: boolean) => void;
}

/**
 * Scroll infini des listes de produits, partagé par le Catalogue et le
 * panier : pages de `/api/products` (même requête, mêmes filtres tenant que
 * le rendu serveur), garde synchrone contre les doubles déclenchements,
 * annulation de la page en vol quand la liste change, dédoublonnage défensif
 * (le classement « recommandé » peut bouger entre deux pages), échec réseau
 * → bouton « Réessayer » (le sentinel resté visible ne redéclencherait rien).
 * L'observer est ré-armé après chaque page : si le sentinel est toujours dans
 * la zone (écran haut, page courte), la suivante s'enchaîne.
 */
export function useInfiniteProducts<T extends { id: string }>({
  initialItems,
  initialPage,
  initialHasMore,
  buildParams,
  autoLoad = true,
  rootMargin = '0px 0px 1200px 0px',
  onPageLoaded,
}: InfiniteProductsOptions<T>): InfiniteProductsState<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [page, setPage] = useState(initialPage);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  // Garde synchrone : l'observer peut notifier deux fois avant le re-rendu.
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef({ page, hasMore });
  stateRef.current = { page, hasMore };
  const optionsRef = useRef({ buildParams, onPageLoaded });
  optionsRef.current = { buildParams, onPageLoaded };

  const reset = useCallback((nextItems: T[], nextPage: number, nextHasMore: boolean) => {
    // Une page encore en vol appartient à l'ancienne liste : jamais ajoutée à la nouvelle.
    abortRef.current?.abort();
    abortRef.current = null;
    loadingRef.current = false;
    setIsLoadingMore(false);
    setItems(nextItems);
    setPage(nextPage);
    setHasMore(nextHasMore);
    setLoadMoreFailed(false);
  }, []);

  // Nouveau rendu serveur (recherche, catégorie, URL ?page=N) : nouvelle liste.
  useEffect(() => {
    reset(initialItems, initialPage, initialHasMore);
  }, [initialItems, initialPage, initialHasMore, reset]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !stateRef.current.hasMore) return;
    loadingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoadingMore(true);
    setLoadMoreFailed(false);
    const nextPage = stateRef.current.page + 1;
    try {
      const params = optionsRef.current.buildParams(nextPage);
      params.set('page', String(nextPage));
      const res = await fetch(`/api/products?${params.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as ProductPage<T>;
      if (controller.signal.aborted) return;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(data.products ?? []).filter((p) => !seen.has(p.id))];
      });
      setPage(nextPage);
      setHasMore(Boolean(data.hasNextPage));
      optionsRef.current.onPageLoaded?.(nextPage);
    } catch {
      if (!controller.signal.aborted) setLoadMoreFailed(true);
    } finally {
      if (abortRef.current === controller) {
        loadingRef.current = false;
        abortRef.current = null;
        setIsLoadingMore(false);
      }
    }
  }, []);

  const enabled = autoLoad && hasMore && !loadMoreFailed;
  useEffect(() => {
    if (!enabled || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadMore(); },
      { rootMargin },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, sentinel, rootMargin, loadMore, items.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { items, page, hasMore, isLoadingMore, loadMoreFailed, loadMore, sentinelRef: setSentinel, reset };
}
