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
  draft: 'bg-tone-warning-bg text-tone-warning-fg',
  published: 'bg-tone-success-bg text-tone-success-fg',
  closed: 'bg-a-hover text-a-text-2',
  cancelled: 'bg-tone-danger-bg text-tone-danger-fg',
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
        className="mb-2 inline-flex min-h-10 items-center gap-1.5 text-sm text-a-text-3 transition-colors hover:text-a-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"
      >
        <IconArrowLeft size={15} aria-hidden="true" /> Retour aux événements
      </Link>

      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-a-text">{event.title}</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[event.status]}`}>{STATUS_LABELS[event.status]}</span>
          </div>
          <p className="mt-1 text-sm text-a-text-3">
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
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-a-border bg-a-surface px-3 text-sm font-semibold text-a-text-2 transition-colors hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"
            >
              Voir la page <IconExternalLink size={14} aria-hidden="true" />
            </Link>
          ) : (
            <span className="inline-flex min-h-10 items-center rounded-lg border border-a-border bg-a-surface-2 px-3 text-sm font-medium text-a-text-3" title="La page publique n’est pas disponible pour un brouillon ou un événement annulé.">
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
              className="min-h-10 w-full rounded-lg border border-a-border bg-a-surface px-3 text-sm font-semibold text-a-text-2 focus:outline-none focus:ring-2 focus:ring-a-focus disabled:opacity-60"
            >
              {(Object.keys(STATUS_LABELS) as EventStatus[]).map((status) => <option key={status} value={status}>{`Changer le statut · ${STATUS_LABELS[status]}`}</option>)}
            </select>
            {statusError && <p className="mt-1.5 max-w-xs text-xs text-tone-danger-fg">{statusError}</p>}
          </div>
        </div>
      </header>

      <div className="mt-3 overflow-x-auto border-b border-a-border" role="tablist" aria-label="Sections de l’événement">
        <div className="flex min-w-max gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.value}
              onClick={() => onTabChange(tab.value)}
              className={`min-h-10 border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus ${
                activeTab === tab.value
                  ? 'border-a-brand font-bold text-a-brand-fg'
                  : 'border-transparent font-semibold text-a-text-3 hover:text-a-text'
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
