'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { IconAdjustmentsHorizontal, IconSearch, IconX } from '@tabler/icons-react';
import type { AdminTone } from '@/lib/admin/tokens';
import { cn } from '@/lib/utils/cn';
import { CountBadge } from '../ui/Badge';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import { FormField, Input, Select } from '../ui/Form';

export interface FilterView { key: string; label: string; href: string; active: boolean; count?: number; countTone?: AdminTone }
export type FilterDef =
  | { type: 'select'; key: string; label: string; options: { value: string; label: string }[]; allLabel?: string }
  | { type: 'date-range'; label: string; fromKey: string; toKey: string };
export interface ActiveFilterChip { key: string; label: string; href: string }

interface FilterBarProps {
  /** Quick views (links computed on the server, filters kept). */
  views?: FilterView[];
  viewsLabel?: string;
  search?: { param?: string; placeholder: string; label: string };
  /** Fields of the « Filtres » panel. */
  filters?: FilterDef[];
  activeChips?: ActiveFilterChip[];
  resetHref?: string;
  sort?: { param?: string; value: string; options: { value: string; label: string }[] };
  /** « 9 résultats » — announced politely after each change. */
  resultLabel?: string;
  /** Extra controls on the right (export, density…). */
  trailing?: ReactNode;
  /** URL keys removed when a panel select changes (e.g. a quick view that the new filter replaces). */
  panelClears?: string[];
}

/**
 * Toolbar of a server-rendered list. Every change replaces the URL (page reset
 * to 1) and the Server Component re-renders with the new data; the URL is the
 * only state.
 */
export default function FilterBar({ views, viewsLabel = 'Vues', search, filters, activeChips = [], resetHref, sort, resultLabel, trailing, panelClears = [] }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const searchParam = search?.param ?? 'q';
  const urlQuery = searchParams.get(searchParam) ?? '';
  const [query, setQuery] = useState(urlQuery);
  const [panelOpen, setPanelOpen] = useState(false);
  const typed = useRef(false);

  // External navigation (reset link, back button) wins over the input.
  useEffect(() => { if (!typed.current) setQuery(urlQuery); typed.current = false; }, [urlQuery]);

  function replace(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') params.delete(key); else params.set(key, value);
    }
    params.delete('page');
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  useEffect(() => {
    if (!search || query.trim() === urlQuery) return;
    const timer = window.setTimeout(() => { typed.current = true; replace({ [searchParam]: query.trim() || null }); }, 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const filterKeys = useMemo(() => (filters ?? []).flatMap((def) => (def.type === 'select' ? [def.key] : [def.fromKey, def.toKey])), [filters]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  function openPanel() {
    setDraft(Object.fromEntries(filterKeys.map((key) => [key, searchParams.get(key) ?? ''])));
    setPanelOpen(true);
  }
  function applyPanel() {
    const selectChanged = (filters ?? []).some((def) => def.type === 'select' && (draft[def.key] ?? '') !== (searchParams.get(def.key) ?? ''));
    replace({
      ...Object.fromEntries(filterKeys.map((key) => [key, draft[key] || null])),
      ...(selectChanged ? Object.fromEntries(panelClears.map((key) => [key, null])) : {}),
    });
    setPanelOpen(false);
  }
  const panelActive = filterKeys.filter((key) => searchParams.get(key)).length;

  return (
    <div className="relative border-b border-a-border" aria-busy={pending || undefined}>
      {pending && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-a-brand" />}
      <div className="flex flex-col gap-2 p-2.5 lg:flex-row lg:items-center">
        {views && views.length > 0 && (
          <nav aria-label={viewsLabel} className="-mx-1 flex shrink-0 gap-0.5 overflow-x-auto px-1 [scrollbar-width:none]">
            <div className="flex gap-0.5 rounded-lg border border-a-border bg-a-surface-2 p-0.5">
              {views.map((view) => (
                <Link key={view.key} href={view.href} aria-current={view.active ? 'true' : undefined} scroll={false}
                  className={cn('inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm',
                    view.active ? 'bg-a-surface font-semibold text-a-text shadow-sm' : 'text-a-text-2 hover:text-a-text')}>
                  {view.label}
                  {view.count !== undefined && view.count > 0 && <CountBadge tone={view.countTone ?? 'neutral'} count={view.count} />}
                </Link>
              ))}
            </div>
          </nav>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {search && (
            <div className="relative min-w-0 flex-1">
              <IconSearch size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery(''); } }}
                aria-label={search.label}
                placeholder={search.placeholder}
                className="h-9 w-full rounded-lg border border-a-border-strong bg-a-surface pl-9 pr-9 text-sm text-a-text placeholder:text-a-text-3 focus:border-a-brand focus:outline focus:outline-2 focus:outline-a-focus [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche"
                  className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-a-text-3 hover:bg-a-hover hover:text-a-text">
                  <IconX size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          {filters && filters.length > 0 && (
            <Button variant="secondary" size="sm" onClick={openPanel} aria-haspopup="dialog" className="shrink-0">
              <IconAdjustmentsHorizontal size={16} aria-hidden="true" />Filtres{panelActive > 0 && <CountBadge tone="neutral" count={panelActive} />}
            </Button>
          )}
          {sort && (
            <label className="flex shrink-0 items-center gap-1.5 text-sm text-a-text-2">
              <span className="hidden xl:inline">Tri</span>
              <select
                value={sort.value}
                onChange={(event) => replace({ [sort.param ?? 'sort']: event.target.value })}
                aria-label="Trier la liste"
                className="h-9 max-w-[12rem] rounded-lg border border-a-border-strong bg-a-surface px-2 text-sm text-a-text focus:outline focus:outline-2 focus:outline-a-focus"
              >
                {sort.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          )}
          {trailing}
        </div>
      </div>
      {(activeChips.length > 0 || resultLabel) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-a-border px-3 py-2 text-sm">
          {activeChips.length > 0 && <span className="text-a-text-3">Filtres actifs</span>}
          {activeChips.map((chip) => (
            <Link key={chip.key} href={chip.href} scroll={false} aria-label={`Retirer le filtre ${chip.label}`}
              className="inline-flex min-h-7 items-center gap-1 rounded-full bg-a-brand-soft px-2.5 text-xs font-semibold text-a-brand-fg hover:bg-a-selected">
              {chip.label}<IconX size={12} aria-hidden="true" />
            </Link>
          ))}
          {activeChips.length > 0 && resetHref && <Link href={resetHref} scroll={false} className="px-1 text-xs font-semibold text-a-brand-fg hover:underline">Tout effacer</Link>}
          {resultLabel && <span aria-live="polite" className="ml-auto text-a-text-2">{resultLabel}</span>}
        </div>
      )}
      {filters && filters.length > 0 && (
        <Dialog
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          size="sm"
          title="Filtres"
          footer={<>
            <Button variant="secondary" onClick={() => setDraft(Object.fromEntries(filterKeys.map((key) => [key, ''])))}>Effacer</Button>
            <Button onClick={applyPanel}>Appliquer</Button>
          </>}
        >
          <div className="space-y-4">
            {filters.map((def) => def.type === 'select' ? (
              <FormField key={def.key} label={def.label}>
                <Select value={draft[def.key] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, [def.key]: event.target.value }))}>
                  <option value="">{def.allLabel ?? 'Tous'}</option>
                  {def.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </FormField>
            ) : (
              <fieldset key={def.fromKey} className="min-w-0">
                <legend className="mb-1.5 text-sm font-semibold text-a-text">{def.label}</legend>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label={<span className="font-normal text-a-text-2">Du</span>}><Input type="date" value={draft[def.fromKey] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, [def.fromKey]: event.target.value }))} /></FormField>
                  <FormField label={<span className="font-normal text-a-text-2">Au</span>}><Input type="date" value={draft[def.toKey] ?? ''} min={draft[def.fromKey] || undefined} onChange={(event) => setDraft((current) => ({ ...current, [def.toKey]: event.target.value }))} /></FormField>
                </div>
              </fieldset>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
