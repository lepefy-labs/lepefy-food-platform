'use client';

import { IconSearch } from '@tabler/icons-react';
import type { InquiryFilter } from '../inquiryTypes';

const FILTERS: { value: InquiryFilter; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'new', label: 'Nouvelles' },
  { value: 'actionable', label: 'À traiter' },
  { value: 'followup', label: 'En suivi' },
  { value: 'done', label: 'Terminées' },
];

export default function InquiryToolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filter: InquiryFilter;
  onFilterChange: (value: InquiryFilter) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-gray-200 bg-white p-3 lg:flex-row lg:items-center lg:justify-between dark:border-gray-800 dark:bg-gray-900">
      <label className="relative block w-full min-w-0 lg:max-w-md">
        <span className="sr-only">Rechercher une demande</span>
        <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Rechercher un client ou un email…"
          className="min-h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] sm:text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
        />
      </label>
      <div className="flex max-w-full gap-1 overflow-x-auto pb-0.5" aria-label="Filtrer les demandes">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onFilterChange(item.value)}
            className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
              filter === item.value
                ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)] dark:text-white'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
