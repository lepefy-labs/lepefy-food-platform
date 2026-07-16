'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, useEffect, useRef } from 'react';
import { ProductGrid } from '@/components/catalog/ProductGrid';
import { SemanticProductCard } from '@/components/catalog/SemanticProductCard';
import type { Category, ProductWithCategory, SemanticMatch } from '@lepefy/types';

interface Props {
  categories:      Category[];
  products:        ProductWithCategory[];
  activeSlug?:     string;
  initialQuery:    string;
  semanticEnabled: boolean;
}

export function CatalogClient({
  categories,
  products,
  activeSlug,
  initialQuery,
  semanticEnabled,
}: Props) {
  const router        = useRouter();
  const searchParams  = useSearchParams();
  const [query, setQuery]            = useState(initialQuery);
  const [isPending, startTransition] = useTransition();
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [semanticResults, setSemanticResults]     = useState<SemanticMatch[]>([]);
  const [isSemanticLoading, setIsSemanticLoading] = useState(false);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  // Cascade : la recherche sémantique ne se déclenche que si la recherche
  // textuelle existante donne peu de résultats — elle ne la remplace jamais.
  useEffect(() => {
    const trimmed = initialQuery.trim();
    if (!semanticEnabled || !trimmed || products.length >= 3) {
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
  }, [initialQuery, products.length, semanticEnabled]);

  const textualIds = new Set(products.map(p => p.id));
  const semanticOnly = semanticResults.filter(p => !textualIds.has(p.id));

  function buildUrl(overrides: { q?: string; category?: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    const newQ = overrides.q !== undefined ? overrides.q : query;
    if (newQ.trim()) params.set('q', newQ.trim());
    else params.delete('q');
    if (overrides.category !== undefined) {
      if (overrides.category) params.set('category', overrides.category);
      else params.delete('category');
    }
    const qs = params.toString();
    return `/products${qs ? '?' + qs : ''}`;
  }

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

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Search bar */}
      <div className="flex items-center gap-2 bg-white rounded-full
                      border border-gray-200 shadow-sm px-4 py-3 mb-4">
        {isPending ? (
          <svg
            className="shrink-0 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            width="16" height="16" viewBox="0 0 24 24"
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
            width="16" height="16" viewBox="0 0 24 24"
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
          placeholder="Rechercher dans le catalogue..."
          className="flex-1 bg-transparent text-sm text-gray-700
                     placeholder:text-gray-400 outline-none border-none"
          aria-label="Rechercher un produit"
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
        />
        {query && (
          <button
            type="button"
            onClick={() => handleQueryChange('')}
            className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
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

      {/* Filtri categoria — nascosti durante ricerca testuale */}
      {!hasActiveSearch && (
        <div className="flex gap-2 flex-wrap mb-5">
          <button
            onClick={() => handleCategorySelect(null)}
            className="px-4 py-1.5 rounded-full text-sm font-medium border transition-colors"
            style={!activeSlug
              ? { backgroundColor: 'var(--color-primary)', color: 'white', borderColor: 'var(--color-primary)' }
              : { borderColor: '#d1d5db', color: '#374151' }
            }
          >
            Tout
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => handleCategorySelect(cat.slug)}
              className="px-4 py-1.5 rounded-full text-sm font-medium border transition-colors"
              style={activeSlug === cat.slug
                ? { backgroundColor: 'var(--color-primary)', color: 'white', borderColor: 'var(--color-primary)' }
                : { borderColor: '#d1d5db', color: '#374151' }
              }
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Header risultati */}
      <div className="flex items-center justify-between mb-4">
        {hasActiveSearch ? (
          <p className="text-sm text-gray-500">
            <span className="font-medium text-gray-900">{products.length}</span>
            {products.length === 1 ? ' résultat' : ' résultats'} pour{' '}
            <span className="font-medium text-gray-900">&ldquo;{initialQuery}&rdquo;</span>
          </p>
        ) : (
          <h1 className="font-display text-lg font-bold text-gray-900">
            {activeSlug
              ? (categories.find(c => c.slug === activeSlug)?.name ?? 'Sélection de la boutique')
              : 'Sélection de la boutique'
            }
          </h1>
        )}
        {hasActiveSearch && (
          <button
            onClick={() => handleQueryChange('')}
            className="text-sm font-medium"
            style={{ color: 'var(--color-primary)' }}
          >
            ← Tout voir
          </button>
        )}
      </div>

      {/* Griglia */}
      <ProductGrid products={products} loading={isPending} />

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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {semanticOnly.map(product => <SemanticProductCard key={product.id} product={product} />)}
          </div>
        </div>
      )}
    </div>
  );
}
