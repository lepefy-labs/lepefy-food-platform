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
    <div className="flex flex-col gap-2.5 rounded-xl border border-a-border bg-a-surface p-3 lg:flex-row lg:items-center lg:justify-between">
      <label className="relative block w-full min-w-0 lg:max-w-md">
        <span className="sr-only">Rechercher une demande</span>
        <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Rechercher un client ou un email…"
          className="min-h-11 w-full rounded-lg border border-a-border bg-a-surface pl-9 pr-3 text-base text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus sm:text-sm"
        />
      </label>
      <div className="flex max-w-full gap-1 overflow-x-auto pb-0.5" aria-label="Filtrer les demandes">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onFilterChange(item.value)}
            className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus ${
              filter === item.value
                ? 'bg-a-brand-soft text-a-brand-fg'
                : 'text-a-text-3 hover:bg-a-surface-2 hover:text-a-text'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
