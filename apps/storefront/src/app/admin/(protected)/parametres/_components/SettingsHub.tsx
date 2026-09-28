'use client';

import Link from 'next/link';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { IconChevronRight, IconFileText, IconQrcode, IconSearch, IconX, type Icon } from '@tabler/icons-react';
import { RELATED_DESTINATIONS, SETTINGS_GROUPS, type SettingsAccent, type SettingsStatusMap } from './settingsRegistry';
import { SettingsIconTile, SettingsStatusBadge } from './SettingsUi';

const RELATED_VISUALS: Record<string, { icon: Icon; accent: SettingsAccent }> = {
  '/admin/contenu': { icon: IconFileText, accent: 'blue' },
  '/admin/outils': { icon: IconQrcode, accent: 'teal' },
};

interface SearchItem {
  id: string;
  title: string;
  description: string;
  category: string;
  href: string;
  haystack: string;
  icon: Icon;
  accent: SettingsAccent;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const SEARCH_INDEX: SearchItem[] = [
  ...SETTINGS_GROUPS.flatMap((group) => group.sections.flatMap((section) => [
    {
      id: section.key,
      title: section.title,
      description: section.description,
      category: group.label,
      href: section.href,
      haystack: normalize([section.title, section.description, group.label, ...section.keywords].join(' ')),
      icon: section.icon,
      accent: section.accent,
    },
    ...section.entries.map((entry, index) => ({
      id: `${section.key}-${index}`,
      title: entry.title,
      description: entry.description,
      category: `${group.label} › ${section.navLabel}`,
      href: entry.href,
      haystack: normalize([entry.title, entry.description, section.title, ...(entry.keywords ?? [])].join(' ')),
      icon: section.icon,
      accent: section.accent,
    })),
  ])),
  ...RELATED_DESTINATIONS.map((item) => ({
    id: item.href,
    title: item.title,
    description: item.description,
    category: `${item.category} (hors paramètres)`,
    href: item.href,
    haystack: normalize([item.title, item.description, ...item.keywords].join(' ')),
    icon: RELATED_VISUALS[item.href]?.icon ?? IconFileText,
    accent: RELATED_VISUALS[item.href]?.accent ?? 'blue',
  })),
];

function searchSettings(query: string): SearchItem[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const first = terms[0];
  if (!first) return [];
  return SEARCH_INDEX
    .filter((item) => terms.every((term) => item.haystack.includes(term)))
    .sort((a, b) => Number(normalize(b.title).includes(first)) - Number(normalize(a.title).includes(first)))
    .slice(0, 12);
}

export function SettingsHub({ statuses }: { statuses: SettingsStatusMap }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchSettings(query), [query]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputId = useId();
  const statusId = useId();
  const searching = query.trim().length > 0;

  function focusResult(index: number) {
    const links = listRef.current?.querySelectorAll<HTMLAnchorElement>('a');
    if (!links || links.length === 0) return;
    links[Math.max(0, Math.min(index, links.length - 1))]?.focus();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); focusResult(0); }
    if (event.key === 'Escape') setQuery('');
  }

  function onResultKeyDown(event: KeyboardEvent<HTMLAnchorElement>, index: number) {
    if (event.key === 'ArrowDown') { event.preventDefault(); focusResult(index + 1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); if (index === 0) inputRef.current?.focus(); else focusResult(index - 1); }
    if (event.key === 'Escape') { setQuery(''); inputRef.current?.focus(); }
  }

  return (
    <div>
      <div role="search" className="mb-8">
        <label htmlFor={inputId} className="sr-only">Rechercher un paramètre</label>
        <div className="relative">
          <IconSearch size={19} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Rechercher un paramètre…"
            autoComplete="off"
            aria-describedby={statusId}
            className="min-h-12 w-full rounded-xl border border-gray-200 bg-white pl-11 pr-12 text-sm text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 [&::-webkit-search-cancel-button]:hidden"
          />
          {searching && (
            <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Effacer la recherche" className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] dark:hover:text-gray-200">
              <IconX size={17} />
            </button>
          )}
        </div>
        <p id={statusId} role="status" className="sr-only">
          {searching ? `${results.length} résultat${results.length > 1 ? 's' : ''}` : ''}
        </p>

        {searching && (
          <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
            {results.length > 0 ? (
              <ul ref={listRef} aria-label="Résultats de recherche" className="divide-y divide-gray-100 dark:divide-gray-800">
                {results.map((result, index) => (
                  <li key={result.id}>
                    <Link href={result.href} onKeyDown={(event) => onResultKeyDown(event, index)} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--admin-primary)] dark:hover:bg-white/5 dark:focus-visible:bg-white/5">
                      <SettingsIconTile icon={result.icon} accent={result.accent} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-950 dark:text-gray-100">{result.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">{result.category}</span>
                      </span>
                      <span className="hidden max-w-[45%] truncate text-xs text-gray-400 sm:block">{result.description}</span>
                      <IconChevronRight size={16} aria-hidden="true" className="shrink-0 text-gray-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">Aucun paramètre ne correspond à « {query.trim()} ».</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-8" hidden={searching}>
        {SETTINGS_GROUPS.map((group) => (
          <section key={group.key} aria-labelledby={`settings-group-${group.key}`}>
            <h2 id={`settings-group-${group.key}`} className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">{group.label}</h2>
            <ul className="overflow-hidden rounded-2xl border border-gray-200 bg-white max-md:divide-y max-md:divide-gray-100 md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent dark:border-gray-800 dark:bg-gray-900 max-md:dark:divide-gray-800 md:dark:bg-transparent">
              {group.sections.map((section) => {
                const status = statuses[section.key];
                return (
                  <li key={section.key}>
                    <Link href={section.href} className="group flex h-full min-h-16 items-center gap-4 px-4 py-3.5 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--admin-primary)] md:rounded-2xl md:border md:border-gray-200 md:bg-white md:p-5 md:hover:border-gray-300 md:hover:shadow-sm dark:hover:bg-white/5 md:dark:border-gray-800 md:dark:bg-gray-900 md:dark:hover:border-gray-700">
                      <SettingsIconTile icon={section.icon} accent={section.accent} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-gray-950 dark:text-gray-100">{section.title}</span>
                        <span className="mt-0.5 hidden text-sm leading-5 text-gray-500 dark:text-gray-400 sm:block">{section.description}</span>
                        {status && <span className="mt-1.5 block"><SettingsStatusBadge status={status} /></span>}
                      </span>
                      <IconChevronRight size={18} aria-hidden="true" className="shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-500" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <section aria-labelledby="settings-related" className="border-t border-gray-200 pt-6 dark:border-gray-800">
          <h2 id="settings-related" className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">Ailleurs dans l’administration</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {RELATED_DESTINATIONS.map((item) => {
              const visual = RELATED_VISUALS[item.href] ?? { icon: IconFileText, accent: 'blue' as const };
              return (
                <li key={item.href}>
                  <Link href={item.href} className="flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm text-gray-600 hover:bg-white hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-white">
                    <SettingsIconTile icon={visual.icon} accent={visual.accent} size="sm" />
                    <span className="min-w-0 flex-1"><span className="font-medium">{item.title}</span><span className="block truncate text-xs text-gray-500 dark:text-gray-400">{item.description}</span></span>
                    <IconChevronRight size={16} aria-hidden="true" className="shrink-0 text-gray-300" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
