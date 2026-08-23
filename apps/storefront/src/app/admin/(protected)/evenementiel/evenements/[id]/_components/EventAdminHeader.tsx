'use client';

import Link from 'next/link';
import { IconArrowLeft, IconExternalLink } from '@tabler/icons-react';
import type { EventRow, EventStatus } from '@lepefy/types';

export type EventAdminTab = 'summary' | 'reservations' | 'ticketing' | 'page';

const STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Brouillon',
  published: 'Publié',
  closed: 'Clôturé',
  cancelled: 'Annulé',
};

const STATUS_CLASSES: Record<EventStatus, string> = {
  draft: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  published: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  closed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  cancelled: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

const TABS: { value: EventAdminTab; label: string }[] = [
  { value: 'summary', label: 'Résumé' },
  { value: 'reservations', label: 'Réservations' },
  { value: 'ticketing', label: 'Billetterie' },
  { value: 'page', label: 'Page événement' },
];

export function EventAdminHeader({
  event,
  activeTab,
  onTabChange,
  onStatusChange,
  savingStatus,
  statusError,
}: {
  event: EventRow;
  activeTab: EventAdminTab;
  onTabChange: (tab: EventAdminTab) => void;
  onStatusChange: (status: EventStatus) => void;
  savingStatus: boolean;
  statusError: string | null;
}) {
  const publicHref = `/evenementiel/evenements/${event.slug}`;
  const publicEnabled = event.status !== 'draft' && event.status !== 'cancelled';
  const reserved = Math.max(0, event.capacity_total - event.capacity_remaining);

  return (
    <>
      <Link
        href="/admin/evenementiel/evenements"
        className="mb-2 inline-flex min-h-10 items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:text-gray-400 dark:hover:text-gray-200"
      >
        <IconArrowLeft size={15} aria-hidden="true" /> Retour aux événements
      </Link>

      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">{event.title}</h1>
            <span className={`rounded-full px-2.5 py-1 text-2xs font-semibold ${STATUS_CLASSES[event.status]}`}>{STATUS_LABELS[event.status]}</span>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {new Date(event.date_start).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
            {event.location ? ` · ${event.location}` : ''}
            {` · ${reserved} / ${event.capacity_total} places réservées`}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          {publicEnabled ? (
            <Link
              href={publicHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/5"
            >
              Voir la page <IconExternalLink size={14} aria-hidden="true" />
            </Link>
          ) : (
            <span className="inline-flex min-h-10 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-400 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-500" title="La page publique n’est pas disponible pour un brouillon ou un événement annulé.">
              Page publique indisponible
            </span>
          )}

          <div className="min-w-44">
            <label htmlFor="event-status" className="sr-only">Changer le statut</label>
            <select
              id="event-status"
              value={event.status}
              onChange={(e) => onStatusChange(e.target.value as EventStatus)}
              disabled={savingStatus}
              aria-label="Changer le statut de l’événement"
              title="Changer le statut"
              className="min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              {(Object.keys(STATUS_LABELS) as EventStatus[]).map((status) => <option key={status} value={status}>{`Changer le statut · ${STATUS_LABELS[status]}`}</option>)}
            </select>
            {statusError && <p className="mt-1.5 max-w-xs text-xs text-red-600 dark:text-red-400">{statusError}</p>}
          </div>
        </div>
      </header>

      <div className="mt-3 overflow-x-auto border-b border-gray-200 dark:border-gray-800" role="tablist" aria-label="Sections de l’événement">
        <div className="flex min-w-max gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.value}
              onClick={() => onTabChange(tab.value)}
              className={`min-h-10 border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                activeTab === tab.value
                  ? 'border-[var(--color-primary)] font-bold text-[var(--color-primary-dark)] dark:text-white'
                  : 'border-transparent font-semibold text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
