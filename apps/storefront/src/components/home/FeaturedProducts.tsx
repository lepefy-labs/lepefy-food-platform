'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ProductCard } from '@/components/catalog/ProductCard';
import type { HomeProduct } from '@/app/(shop)/accueil/page';

interface Props {
  products: HomeProduct[];
}

export function FeaturedProducts({ products }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p => p.name.toLowerCase().includes(q));
  }, [query, products]);

  if (products.length === 0) {
    return <SearchBar query={query} onChange={setQuery} />;
  }

  return (
    <>
      <SearchBar query={query} onChange={setQuery} />

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-900">
            {query ? `Résultats (${filtered.length})` : 'Nos produits vedettes'}
          </h2>
          {!query && (
            <Link
              href="/products"
              className="text-2xs font-medium"
              style={{ color: 'var(--color-primary)' }}
            >
              Voir tout →
            </Link>
          )}
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">
            Aucun produit trouvé pour &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto pb-1
                          [&::-webkit-scrollbar]:hidden
                          [-ms-overflow-style:none]
                          [scrollbar-width:none]">
            {filtered.map(product => (
              <ProductCard key={product.id} product={product} variant="shelf" />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SearchBar({
  query,
  onChange,
}: {
  query: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-white rounded-full
                    border border-gray-200 shadow-sm px-4 py-2.5">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#9ca3af"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
        <path d="M21 21l-6 -6" />
      </svg>
      <input
        type="search"
        value={query}
        onChange={e => onChange(e.target.value)}
        placeholder="Rechercher un produit..."
        className="flex-1 bg-transparent text-sm text-gray-700
                   placeholder:text-gray-400 outline-none border-none"
        aria-label="Rechercher un produit"
      />
      {query && (
        <button
          onClick={() => onChange('')}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Effacer la recherche"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M18 6l-12 12" /><path d="M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
