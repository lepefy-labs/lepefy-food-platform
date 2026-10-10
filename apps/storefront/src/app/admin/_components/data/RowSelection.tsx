'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface SelectionApi {
  selected: Set<string>;
  toggle: (id: string) => void;
  setMany: (ids: string[], value: boolean) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionApi | null>(null);

export function useRowSelection(): SelectionApi {
  const api = useContext(SelectionContext);
  if (!api) throw new Error('useRowSelection must be used inside <RowSelectionProvider>');
  return api;
}

/** Selection of the rows shown on the current page; cleared when the page's rows change. */
export function RowSelectionProvider({ rowIds, children }: { rowIds: string[]; children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const key = rowIds.join(',');
  useEffect(() => {
    // Keep only rows still visible (new page, new filter, row removed).
    setSelected((current) => new Set([...current].filter((id) => rowIds.includes(id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const toggle = useCallback((id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const setMany = useCallback((ids: string[], value: boolean) => setSelected((current) => {
    const next = new Set(current);
    for (const id of ids) { if (value) next.add(id); else next.delete(id); }
    return next;
  }), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const api = useMemo(() => ({ selected, toggle, setMany, clear }), [selected, toggle, setMany, clear]);
  return <SelectionContext.Provider value={api}>{children}</SelectionContext.Provider>;
}

const BOX = 'h-4 w-4 cursor-pointer rounded border-a-border-strong accent-[var(--admin-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus';

export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useRowSelection();
  return <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} aria-label={label} className={BOX} />;
}

export function SelectAllCheckbox({ ids, label = 'Sélectionner toutes les lignes de la page' }: { ids: string[]; label?: string }) {
  const { selected, setMany } = useRowSelection();
  const ref = useRef<HTMLInputElement>(null);
  const count = ids.filter((id) => selected.has(id)).length;
  const all = ids.length > 0 && count === ids.length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = count > 0 && !all; }, [count, all]);
  return <input ref={ref} type="checkbox" checked={all} disabled={ids.length === 0} onChange={() => setMany(ids, !all)} aria-label={label} className={BOX} />;
}

/**
 * Floating bar of bulk actions, shown while rows are selected. `children`
 * receives the selected ids (in row order) and a function to clear them.
 */
export function BulkBar({ rowIds, noun = 'sélectionnée', nounPlural = 'sélectionnées', children }: {
  rowIds: string[];
  noun?: string;
  nounPlural?: string;
  children: (ids: string[], clear: () => void) => ReactNode;
}) {
  const { selected, clear } = useRowSelection();
  const ids = rowIds.filter((id) => selected.has(id));
  if (ids.length === 0) return null;
  return (
    <div role="region" aria-label="Actions sur la sélection" className={cn(
      'fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex flex-wrap items-center gap-2 rounded-xl border border-a-border bg-a-surface px-3 py-2 shadow-xl',
      'md:inset-x-auto md:bottom-6 md:left-1/2 md:w-max md:max-w-[calc(100vw-3rem)] md:-translate-x-1/2 md:flex-nowrap',
    )}>
      <span className="mr-1 text-sm font-semibold text-a-text" aria-live="polite">{ids.length} {ids.length > 1 ? nounPlural : noun}</span>
      <span aria-hidden="true" className="hidden h-5 w-px bg-a-border sm:block" />
      {children(ids, clear)}
      <button type="button" onClick={clear} className="ml-auto min-h-9 rounded-lg px-2.5 text-sm font-semibold text-a-text-2 hover:bg-a-hover hover:text-a-text md:ml-0">Désélectionner</button>
    </div>
  );
}
