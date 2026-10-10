'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconArrowRight, IconBuildingWarehouse, IconCalendarEvent, IconPackage, IconSearch, IconShoppingBag, IconTruckLoading, IconUsers, type Icon,
} from '@tabler/icons-react';
import { ADMIN_QUICK_ACTIONS, navItemsById } from '@/lib/admin/navigation';
import { cn } from '@/lib/utils/cn';
import Dialog from '../ui/Dialog';
import { PLATFORM_NAV } from '../platformNavConfig';
import type { AdminSearchScope, AdminShellNav } from './shellState';

interface PaletteEntry { id: string; group: string; label: string; sublabel?: string | null; href: string; icon: Icon; terms?: string }
interface RemoteResult { id: string; label: string; sublabel: string | null; href: string }

const REMOTE_GROUPS: { scope: AdminSearchScope; label: string; icon: Icon }[] = [
  { scope: 'orders', label: 'Commandes', icon: IconShoppingBag },
  { scope: 'customers', label: 'Clients', icon: IconUsers },
  { scope: 'products', label: 'Produits', icon: IconPackage },
  { scope: 'events', label: 'Événements', icon: IconCalendarEvent },
  { scope: 'suppliers', label: 'Fournisseurs', icon: IconBuildingWarehouse },
  { scope: 'purchases', label: 'Achats', icon: IconTruckLoading },
];

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function localEntries(nav: AdminShellNav): PaletteEntry[] {
  const actions = ADMIN_QUICK_ACTIONS.filter((action) => nav.actions.includes(action.id))
    .map((action) => ({ id: `action-${action.id}`, group: 'Actions', label: action.label, href: action.href, icon: action.icon, terms: (action.keywords ?? []).join(' ') }));
  const pages = navItemsById(nav.items).map((item) => ({
    id: `page-${item.id}`, group: 'Pages', label: item.label, sublabel: item.group, href: item.href, icon: item.icon,
    terms: [item.group, ...(item.keywords ?? [])].join(' '),
  }));
  const platform = nav.platform
    ? PLATFORM_NAV.flatMap((group) => (group.children ?? [{ label: group.label, href: group.href ?? '/admin/platform' }])
      .map((child) => ({ id: `platform-${child.href}`, group: 'Plateforme', label: child.label, sublabel: group.label, href: child.href, icon: group.icon, terms: group.label })))
    : [];
  return [...actions, ...pages, ...platform];
}

export default function CommandPalette({ nav, open, onClose }: { nav: AdminShellNav; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<Partial<Record<AdminSearchScope, RemoteResult[]>>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const local = useMemo(() => localEntries(nav), [nav]);

  useEffect(() => { if (!open) { setQuery(''); setRemote({}); setActive(0); setFailed(false); } }, [open]);

  const q = normalizeSearch(query);
  useEffect(() => {
    if (!open || q.length < 2 || nav.searchScopes.length === 0) { setRemote({}); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), scope: nav.searchScopes.join(',') });
      fetch(`/api/admin/search?${params.toString()}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((data: { results?: Partial<Record<AdminSearchScope, RemoteResult[]>> }) => setRemote(data.results ?? {}))
        .catch((error: unknown) => { if ((error as Error)?.name !== 'AbortError') { setRemote({}); setFailed(true); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [q, query, open, nav.searchScopes]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const matching = q
      ? local.filter((entry) => normalizeSearch(`${entry.label} ${entry.terms ?? ''}`).includes(q)).slice(0, 8)
      : local.filter((entry) => entry.group !== 'Plateforme').slice(0, 10);
    const remoteEntries = REMOTE_GROUPS.flatMap(({ scope, label, icon }) => (remote[scope] ?? []).map((result) => ({
      id: `${scope}-${result.id}`, group: label, label: result.label, sublabel: result.sublabel, href: result.href, icon,
    })));
    return [...remoteEntries, ...matching];
  }, [q, local, remote]);

  useEffect(() => { setActive(0); }, [entries.length, q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function go(entry: PaletteEntry | undefined) {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(entries.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); go(entries[active]); }
  }

  const groups: { name: string; items: { entry: PaletteEntry; index: number }[] }[] = [];
  entries.forEach((entry, index) => {
    const last = groups[groups.length - 1];
    if (last && last.name === entry.group) last.items.push({ entry, index });
    else groups.push({ name: entry.group, items: [{ entry, index }] });
  });
  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <Dialog open={open} onClose={onClose} bare placement="top" size="lg" title="Rechercher ou aller à">
      <div className="flex items-center gap-3 border-b border-a-border px-4">
        <IconSearch size={18} aria-hidden="true" className="shrink-0 text-a-text-3" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={entries[active] ? optionId(active) : undefined}
          aria-label="Rechercher une commande, un client, une page…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Rechercher une commande, un client, une page…"
          className="min-h-14 min-w-0 flex-1 bg-transparent text-base text-a-text placeholder:text-a-text-3 focus:outline-none"
        />
        {loading && <span aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-a-border-strong border-t-transparent" />}
        <kbd className="hidden shrink-0 rounded border border-a-border-strong px-1.5 font-mono text-xs text-a-text-2 sm:inline">Échap</kbd>
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label="Résultats" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {groups.map((group) => (
          <div key={group.name} role="group" aria-label={group.name} className="pb-1">
            <p className="px-2.5 pb-1 pt-2 text-xs font-semibold text-a-text-3">{group.name}</p>
            {group.items.map(({ entry, index }) => {
              const Icon = entry.icon;
              return (
                <div
                  key={entry.id}
                  id={optionId(index)}
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={() => go(entry)}
                  className={cn('flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm', index === active ? 'bg-a-selected text-a-text' : 'text-a-text')}
                >
                  <Icon size={18} stroke={1.8} aria-hidden="true" className="shrink-0 text-a-text-2" />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.sublabel && <span className="shrink-0 truncate text-xs text-a-text-3">{entry.sublabel}</span>}
                  {index === active && <IconArrowRight size={16} aria-hidden="true" className="shrink-0 text-a-brand-fg" />}
                </div>
              );
            })}
          </div>
        ))}
        {entries.length === 0 && !loading && (
          <p className="px-3 py-8 text-center text-sm text-a-text-2">
            {q.length > 0 ? <>Aucun résultat pour « {query.trim()} ».</> : 'Aucune page disponible.'}
          </p>
        )}
        {failed && <p role="alert" className="px-3 py-2 text-sm text-tone-danger-fg">La recherche est indisponible. Les pages restent accessibles.</p>}
      </div>
      <div className="hidden items-center gap-4 border-t border-a-border bg-a-surface-2 px-4 py-2 text-xs text-a-text-3 sm:flex">
        <span>↑ ↓ naviguer</span><span>Entrée ouvrir</span><span className="ml-auto">Résultats limités à vos accès</span>
      </div>
    </Dialog>
  );
}
