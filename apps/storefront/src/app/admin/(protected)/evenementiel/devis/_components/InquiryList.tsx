'use client';

import { IconArrowRight, IconCalendar, IconUsers } from '@tabler/icons-react';
import InquiryStatusBadge from './InquiryStatusBadge';
import type { InquiryWithService } from '../inquiryTypes';
import { elapsedLabel, isOldActionable } from '../inquiryTypes';

export default function InquiryList({
  inquiries,
  selectedId,
  onSelect,
}: {
  inquiries: InquiryWithService[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (inquiries.length === 0) {
    return <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">Aucune demande ne correspond à ces critères.</div>;
  }

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="hidden grid-cols-[minmax(180px,1.2fr)_minmax(150px,1fr)_110px_80px_100px_110px] gap-3 border-b border-gray-100 px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-gray-400 xl:grid dark:border-gray-800">
        <span>Client</span><span>Demande</span><span>Date</span><span>Invités</span><span>Reçue</span><span>Statut</span>
      </div>

      <div className="hidden divide-y divide-gray-100 xl:block dark:divide-gray-800">
        {inquiries.map((inquiry) => {
          const selected = inquiry.id === selectedId;
          const old = isOldActionable(inquiry);
          return (
            <button
              key={inquiry.id}
              type="button"
              onClick={() => onSelect(inquiry.id)}
              aria-pressed={selected}
              className={`grid w-full grid-cols-[minmax(180px,1.2fr)_minmax(150px,1fr)_110px_80px_100px_110px] items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] ${selected ? 'bg-[var(--color-primary-light)]/60' : 'hover:bg-gray-50 dark:hover:bg-white/5'}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-gray-950 dark:text-white">{inquiry.customer_name}</span>
                <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">{inquiry.customer_email}</span>
              </span>
              <span className="truncate text-sm text-gray-700 dark:text-gray-200">{inquiry.service_offerings?.title ?? 'Service'}</span>
              <span className="text-xs text-gray-600 dark:text-gray-300">{inquiry.date_souhaitee ? new Date(inquiry.date_souhaitee).toLocaleDateString('fr-FR') : '—'}</span>
              <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300">{inquiry.nombre_invites ?? '—'}</span>
              <span className={`text-xs ${old ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>{elapsedLabel(inquiry.created_at)}</span>
              <InquiryStatusBadge status={inquiry.status} />
            </button>
          );
        })}
      </div>

      <div className="divide-y divide-gray-100 xl:hidden dark:divide-gray-800">
        {inquiries.map((inquiry) => {
          const old = isOldActionable(inquiry);
          return (
            <button key={inquiry.id} type="button" onClick={() => onSelect(inquiry.id)} className="block w-full p-4 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] dark:hover:bg-white/5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-950 dark:text-white">{inquiry.customer_name}</p>
                  <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{inquiry.service_offerings?.title ?? 'Service'}</p>
                </div>
                <InquiryStatusBadge status={inquiry.status} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-1"><IconCalendar size={13} />{inquiry.date_souhaitee ? new Date(inquiry.date_souhaitee).toLocaleDateString('fr-FR') : 'Date non renseignée'}</span>
                <span className="inline-flex items-center gap-1"><IconUsers size={13} />{inquiry.nombre_invites != null ? `${inquiry.nombre_invites} invités` : 'Invités non renseignés'}</span>
                <span className={old ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}>{elapsedLabel(inquiry.created_at)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="truncate text-xs text-gray-500 dark:text-gray-400">{inquiry.customer_email}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--color-primary-dark)]">Ouvrir <IconArrowRight size={13} /></span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
