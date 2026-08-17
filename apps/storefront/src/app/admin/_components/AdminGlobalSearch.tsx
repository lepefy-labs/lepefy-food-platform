'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  IconSearch,
  IconX,
  IconShoppingBag,
  IconPackage,
  IconCalendarEvent,
  IconUsers,
} from '@tabler/icons-react';

type Scope = 'orders' | 'products' | 'events' | 'customers';

interface SearchResultItem {
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
}

type SearchResults = Record<Scope, SearchResultItem[]>;

const EMPTY_RESULTS: SearchResults = { orders: [], products: [], events: [], customers: [] };

// Ordre d'affichage + méta par groupe — mêmes icônes Tabler que AdminSidebar
// pour la même entité (Commandes/Catalogue/Événementiel/Clients), cohérence
// volontaire entre nav et recherche.
const SCOPE_META: { key: Scope; label: string; icon: typeof IconShoppingBag }[] = [
  { key: 'orders',    label: 'Commandes',   icon: IconShoppingBag },
  { key: 'products',  label: 'Produits',    icon: IconPackage },
  { key: 'events',    label: 'Événements',  icon: IconCalendarEvent },
  { key: 'customers', label: 'Clients',     icon: IconUsers },
];

export default function AdminGlobalSearch() {
  const [isOpen, setIsOpen]           = useState(false);
  const [query, setQuery]             = useState('');
  const [activeScopes, setActiveScopes] = useState<Set<Scope>>(new Set());
  const [results, setResults]         = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading]         = useState(false);
  const [searchedOnce, setSearchedOnce] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);
  const abortRef       = useRef<AbortController | null>(null);

  // Set vide = "toutes les portées" (comportement par défaut demandé).
  const effectiveScopes = activeScopes.size > 0 ? activeScopes : new Set(SCOPE_META.map(s => s.key));

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Debounce 300ms + annulation de la requête précédente si l'utilisateur
  // continue de taper (ou change de portée) avant qu'elle ne réponde.
  useEffect(() => {
    if (!isOpen) return;
    if (query.trim().length < 2) {
      setResults(EMPTY_RESULTS);
      setSearchedOnce(false);
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      const params = new URLSearchParams({ q: query.trim(), scope: [...effectiveScopes].join(',') });

      fetch(`/api/admin/search?${params.toString()}`, { signal: controller.signal })
        .then(res => res.json())
        .then(data => {
          setResults(data.results ?? EMPTY_RESULTS);
          setSearchedOnce(true);
        })
        .catch(err => {
          if (err?.name !== 'AbortError') setResults(EMPTY_RESULTS);
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isOpen, [...effectiveScopes].join(',')]);

  function toggleScope(scope: Scope) {
    setActiveScopes(prev => {
      const next = new Set(prev.size > 0 ? prev : SCOPE_META.map(s => s.key));
      if (next.has(scope)) {
        if (next.size === 1) return next; // toujours au moins une portée active
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  }

  function close() {
    setIsOpen(false);
    setQuery('');
    setResults(EMPTY_RESULTS);
    setSearchedOnce(false);
  }

  const totalResults = SCOPE_META.reduce((sum, s) => sum + (results[s.key]?.length ?? 0), 0);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(v => !v)}
        aria-label="Rechercher"
        aria-expanded={isOpen}
        className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
      >
        <IconSearch size={18} />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Recherche globale"
          onKeyDown={e => { if (e.key === 'Escape') close(); }}
          className="fixed inset-x-2 top-16 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl
                     dark:border-gray-800 dark:bg-gray-900
                     sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-96 sm:max-h-[32rem]"
        >
          <div className="p-3 border-b border-gray-100 dark:border-gray-800">
            <div className="relative">
              <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Rechercher une commande, un produit…"
                className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800
                           rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Effacer"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <IconX size={14} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 mt-2">
              {SCOPE_META.map(({ key, label }) => {
                const active = effectiveScopes.has(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleScope(key)}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
                      active
                        ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)] border-transparent'
                        : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-2">
            {query.trim().length < 2 && (
              <p className="text-center text-xs text-gray-400 py-6">Tapez au moins 2 caractères…</p>
            )}

            {loading && (
              <div className="flex items-center justify-center py-6">
                <span
                  aria-hidden="true"
                  className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin text-gray-400"
                />
              </div>
            )}

            {!loading && searchedOnce && totalResults === 0 && (
              <p className="text-center text-xs text-gray-400 py-6">Aucun résultat pour « {query} »</p>
            )}

            {!loading &&
              SCOPE_META.filter(s => effectiveScopes.has(s.key) && results[s.key]?.length > 0).map(({ key, label, icon: Icon }) => (
                <div key={key} className="mb-2 last:mb-0">
                  <p className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <Icon size={13} stroke={1.75} />
                    {label}
                  </p>
                  <ul>
                    {results[key].map(item => (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          onClick={close}
                          className="flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-sm
                                     hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                        >
                          <span className="truncate text-gray-800 dark:text-gray-200">{item.label}</span>
                          {item.sublabel && (
                            <span className="flex-shrink-0 text-xs text-gray-400">{item.sublabel}</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
