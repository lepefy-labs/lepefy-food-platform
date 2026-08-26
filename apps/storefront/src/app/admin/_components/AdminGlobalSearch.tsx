'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { IconSearch, IconX, IconShoppingBag, IconPackage, IconCalendarEvent, IconUsers } from '@tabler/icons-react';
import type { AdminWorkspace } from '@/lib/admin/workspace';

type Scope = 'orders' | 'products' | 'events' | 'customers';
interface SearchResultItem { id: string; label: string; sublabel: string | null; href: string; }
type SearchResults = Record<Scope, SearchResultItem[]>;
const EMPTY_RESULTS: SearchResults = { orders: [], products: [], events: [], customers: [] };
const SCOPE_META: { key: Scope; label: string; icon: typeof IconShoppingBag }[] = [
  { key: 'orders', label: 'Commandes', icon: IconShoppingBag },
  { key: 'products', label: 'Produits', icon: IconPackage },
  { key: 'events', label: 'Événements', icon: IconCalendarEvent },
  { key: 'customers', label: 'Clients', icon: IconUsers },
];

function ResultsPanel({ scopes, query, loading, searchedOnce, results, onSelect }: { scopes: Scope[]; query: string; loading: boolean; searchedOnce: boolean; results: SearchResults; onSelect: () => void; }) {
  const meta = SCOPE_META.filter(item => scopes.includes(item.key));
  const totalResults = meta.reduce((sum, item) => sum + (results[item.key]?.length ?? 0), 0);
  return <div className="p-2">
    {query.trim().length < 2 && <p className="py-6 text-center text-xs text-gray-400">Tapez au moins 2 caractères…</p>}
    {loading && <div className="flex items-center justify-center py-6"><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-gray-400" /></div>}
    {!loading && searchedOnce && totalResults === 0 && <p className="py-6 text-center text-xs text-gray-400">Aucun résultat pour « {query} »</p>}
    {!loading && meta.filter(item => results[item.key]?.length > 0).map(({ key, label, icon: Icon }) => <div key={key} className="mb-2 last:mb-0"><p className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"><Icon size={13} stroke={1.75} />{label}</p><ul>{results[key].map(item => <li key={item.id}><Link href={item.href} onClick={onSelect} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-white/5"><span className="truncate text-gray-800 dark:text-gray-200">{item.label}</span>{item.sublabel && <span className="shrink-0 text-xs text-gray-400">{item.sublabel}</span>}</Link></li>)}</ul></div>)}
  </div>;
}

export default function AdminGlobalSearch({ workspace = 'shop' }: { workspace?: AdminWorkspace }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [searchedOnce, setSearchedOnce] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scopes = useMemo<Scope[]>(() => workspace === 'events' ? ['events'] : ['orders', 'products', 'customers'], [workspace]);
  const placeholder = workspace === 'events' ? 'Rechercher un événement…' : 'Rechercher commandes, produits, clients…';

  useEffect(() => { if (!panelOpen) return; const handleClickOutside = (event: MouseEvent) => { if (containerRef.current && !containerRef.current.contains(event.target as Node)) setPanelOpen(false); }; document.addEventListener('mousedown', handleClickOutside); return () => document.removeEventListener('mousedown', handleClickOutside); }, [panelOpen]);
  useEffect(() => { if (panelOpen) mobileInputRef.current?.focus(); }, [panelOpen]);
  useEffect(() => {
    if (!panelOpen) return;
    if (query.trim().length < 2) { setResults(EMPTY_RESULTS); setSearchedOnce(false); return; }
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      const params = new URLSearchParams({ q: query.trim(), scope: scopes.join(',') });
      fetch(`/api/admin/search?${params.toString()}`, { signal: controller.signal })
        .then(res => res.json()).then(data => { setResults(data.results ?? EMPTY_RESULTS); setSearchedOnce(true); })
        .catch(error => { if (error?.name !== 'AbortError') setResults(EMPTY_RESULTS); })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, panelOpen, scopes]);

  function handleSelect() { setPanelOpen(false); setQuery(''); setResults(EMPTY_RESULTS); setSearchedOnce(false); }
  function closePanel() { setPanelOpen(false); }

  return <div className="relative w-full" ref={containerRef} onKeyDown={event => { if (event.key === 'Escape') closePanel(); }}>
    <div className="relative hidden md:block"><IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input type="text" value={query} onFocus={() => setPanelOpen(true)} onChange={event => setQuery(event.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-8 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-800" />{query && <button onClick={() => setQuery('')} aria-label="Effacer" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><IconX size={14} /></button>}{panelOpen && <div role="dialog" aria-label="Recherche globale" className="absolute left-0 top-full z-50 mt-2 max-h-[32rem] w-full min-w-[20rem] overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"><ResultsPanel scopes={scopes} query={query} loading={loading} searchedOnce={searchedOnce} results={results} onSelect={handleSelect} /></div>}</div>
    <div className="md:hidden"><button onClick={() => setPanelOpen(value => !value)} aria-label="Rechercher" aria-expanded={panelOpen} className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"><IconSearch size={18} /></button>{panelOpen && <div role="dialog" aria-label="Recherche globale" className="fixed inset-x-2 top-16 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"><div className="border-b border-gray-100 p-3 dark:border-gray-800"><div className="relative"><IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input ref={mobileInputRef} type="text" value={query} onChange={event => setQuery(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-gray-200 py-2 pl-8 pr-8 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-800" />{query && <button onClick={() => setQuery('')} aria-label="Effacer" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><IconX size={14} /></button>}</div></div><ResultsPanel scopes={scopes} query={query} loading={loading} searchedOnce={searchedOnce} results={results} onSelect={handleSelect} /></div>}</div>
  </div>;
}
