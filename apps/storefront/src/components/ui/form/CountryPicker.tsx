'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { IconCheck, IconChevronDown, IconSearch } from '@tabler/icons-react';
import { dialCode, filterCountries, flagSrc, type CountryEntry } from '@/lib/address/countries';

/** Seuil à partir duquel la recherche est utile (5 pays de livraison : liste seule). */
const SEARCH_MIN_ENTRIES = 8;

export function CountryFlag({ code, className = '' }: { code: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- petit SVG statique de /public/flags
    <img src={flagSrc(code)} alt="" aria-hidden="true" width={24} height={16} decoding="async"
      className={`h-4 w-6 shrink-0 rounded-[2px] object-cover ring-1 ring-black/10 ${className}`} />
  );
}

export interface CountryPickerProps {
  id: string;
  /** Nom accessible du déclencheur (le libellé visible est rendu par le parent). */
  ariaLabel: string;
  value: string;
  countries: ReadonlyArray<CountryEntry>;
  onChange: (code: string) => void;
  /** Affiche l'indicatif (« +39 ») dans les options : sélecteur téléphonique. */
  showDialCode?: boolean;
  /** Déclencheur compact (drapeau + indicatif) pour le champ téléphone. */
  trigger?: 'full' | 'compact';
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
  renderTriggerLabel?: (entry: CountryEntry | undefined) => ReactNode;
}

/**
 * Sélecteur de pays accessible : bouton + liste (motif ARIA listbox), recherche
 * par nom (et indicatif pour le téléphone), flèches / Entrée / Échap, cibles
 * d'au moins 44 px. Les drapeaux sont des SVG en couleur, jamais des emoji.
 */
export function CountryPicker({
  id, ariaLabel, value, countries, onChange, showDialCode, trigger = 'full', searchPlaceholder, emptyText,
  disabled, invalid, describedBy, className = '', renderTriggerLabel,
}: CountryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = `${useId().replace(/:/g, '')}-countries`;

  const selected = countries.find((entry) => entry.code === value.toUpperCase());
  const searchable = countries.length >= SEARCH_MIN_ENTRIES;
  const visible = useMemo(() => filterCountries(countries, query, showDialCode), [countries, query, showDialCode]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, countries.findIndex((entry) => entry.code === selected?.code)));
    if (!searchable) window.requestAnimationFrame(() => listRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- à l'ouverture seulement
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    setQuery('');
    if (returnFocus) triggerRef.current?.focus();
  }

  function choose(code: string) {
    onChange(code);
    close(true);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(visible.length - 1, i + 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
    if (event.key === 'Home') { event.preventDefault(); setActive(0); return; }
    if (event.key === 'End') { event.preventDefault(); setActive(Math.max(0, visible.length - 1)); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      const entry = visible[active];
      if (entry) choose(entry.code);
      return;
    }
    if (event.key === 'Tab') close(false);
  }

  const compact = trigger === 'compact';
  const dial = selected ? dialCode(selected.code) : null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${ariaLabel}${selected ? ` : ${selected.name}${showDialCode && dial ? ` +${dial}` : ''}` : ''}`}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setOpen(true); }
        }}
        className={`sf-control flex w-full items-center gap-2 text-left ${compact ? 'min-w-[5.75rem] px-3' : ''}`}
      >
        {selected ? <CountryFlag code={selected.code} /> : null}
        {renderTriggerLabel ? renderTriggerLabel(selected) : (
          <span className="min-w-0 flex-1 truncate">
            {compact ? (dial ? `+${dial}` : selected?.code ?? '') : selected?.name ?? ''}
          </span>
        )}
        <IconChevronDown size={18} stroke={2} aria-hidden="true" className="shrink-0 text-[color:var(--field-ink)]" />
      </button>

      {open && (
        <div
          className={`absolute left-0 z-[60] mt-1 overflow-hidden rounded-xl border border-gray-300 bg-white shadow-lg ${compact ? 'w-[min(20rem,calc(100vw-2rem))]' : 'w-full'}`}
          onKeyDown={onKeyDown}
        >
          {searchable && (
            <div className="relative border-b border-gray-200">
              <IconSearch size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                autoFocus
                type="search"
                inputMode="search"
                autoComplete="off"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={visible[active] ? `${listId}-${visible[active]!.code}` : undefined}
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActive(0); }}
                className="h-12 w-full bg-transparent pl-10 pr-3 text-base text-gray-950 outline-none"
              />
            </div>
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={searchable ? -1 : 0}
            aria-activedescendant={!searchable && visible[active] ? `${listId}-${visible[active]!.code}` : undefined}
            className="max-h-64 overflow-y-auto overscroll-contain py-1 outline-none"
          >
            {visible.length === 0 && <li role="presentation" className="px-4 py-3 text-sm text-gray-700">{emptyText}</li>}
            {visible.map((entry, index) => {
              const entryDial = showDialCode ? dialCode(entry.code) : null;
              const isSelected = entry.code === selected?.code;
              return (
                <li
                  key={entry.code}
                  id={`${listId}-${entry.code}`}
                  role="option"
                  aria-selected={isSelected}
                  data-index={index}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(entry.code)}
                  onMouseMove={() => setActive(index)}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 text-[15px] text-gray-950 ${index === active ? 'bg-gray-100' : ''}`}
                >
                  <CountryFlag code={entry.code} />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {entryDial && <span className="shrink-0 tabular-nums text-gray-600">+{entryDial}</span>}
                  {isSelected && <IconCheck size={18} aria-hidden="true" className="shrink-0 text-[color:var(--color-primary-dark)]" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
