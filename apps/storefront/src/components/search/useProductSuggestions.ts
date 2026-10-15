'use client';

import { useEffect, useState } from 'react';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';

export const MIN_QUERY_LENGTH = 2;
const SUGGESTION_LIMIT = 5;
const SUGGEST_DEBOUNCE_MS = 250;
const CACHE_SIZE = 20;
const NO_PRODUCTS: ProductCardProduct[] = [];

export type Suggestions = { products: ProductCardProduct[]; total: number };
type Status = 'idle' | 'loading' | 'ready' | 'error';

// Partagé par toutes les recherches (barre mobile, header desktop, panier)
// pendant la visite : effacer une lettre ou revenir sur un mot déjà tapé ne
// relance pas la requête.
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

export interface ProductSuggestionsState {
  /** Au moins 2 lettres : une recherche a un sens. */
  searchable: boolean;
  /** Recherche en attente (frappe pas encore stabilisée ou requête en cours). */
  loading: boolean;
  /** Propositions prêtes et correspondant exactement au texte du champ. */
  showResults: boolean;
  error: boolean;
  /** Propositions affichables (vide tant que `showResults` est faux). */
  products: ProductCardProduct[];
  total: number;
  retry: () => void;
}

/**
 * Moteur unique des propositions de produits du tenant : `/api/products`
 * (même endpoint et même projection que le catalogue), anti-rebond, cache de
 * visite, annulation des requêtes dépassées. Aucune requête avant 2 lettres
 * ni quand `enabled` est faux. Les présentations (champ global, recherche du
 * panier) ne réimplémentent jamais cette logique.
 */
export function useProductSuggestions(query: string, enabled = true): ProductSuggestionsState {
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<Suggestions>({ products: [], total: 0 });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setDebounced(trimmed), SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, trimmed]);

  useEffect(() => {
    if (!enabled) return;
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
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [enabled, debounced, attempt]);

  const searchable = trimmed.length >= MIN_QUERY_LENGTH;
  // Les propositions affichées correspondent toujours au texte du champ.
  const settled = debounced === trimmed;
  const showResults = searchable && settled && status === 'ready';
  return {
    searchable,
    loading: searchable && (!settled || status === 'loading'),
    showResults,
    error: searchable && settled && status === 'error',
    products: showResults ? result.products : NO_PRODUCTS,
    total: result.total,
    retry: () => setAttempt((n) => n + 1),
  };
}
