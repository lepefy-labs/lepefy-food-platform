import Link from 'next/link';
import { IconArrowRight, IconCalendarEvent, IconCheck, IconClock, IconFileDescription, IconPackage } from '@tabler/icons-react';
import type { OverviewAction, OverviewEvent, OverviewInquiry, OverviewRental } from '@/lib/admin/evenementiel/getEvenementielOverview';

type MetricTone = 'neutral' | 'amber' | 'green' | 'red';

const metricToneClass: Record<MetricTone, string> = {
  neutral: 'border-gray-200 dark:border-gray-800',
  amber: 'border-amber-200 dark:border-amber-900/70',
  green: 'border-emerald-200 dark:border-emerald-900/70',
  red: 'border-red-200 dark:border-red-900/70',
};

export function OverviewMetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  detail?: string;
  tone?: MetricTone;
}) {
  return (
    <div className={`rounded-xl border bg-white px-4 py-3 dark:bg-gray-900 ${metricToneClass[tone]}`}>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-1 flex min-h-8 items-end gap-2">
        <p className="text-[1.65rem] font-semibold leading-none tabular-nums text-gray-950 dark:text-white">{value}</p>
        {detail && <p className="pb-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">{detail}</p>}
      </div>
    </div>
  );
}

const actionToneClass = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
  attention: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  default: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

export function EventActionList({ actions }: { actions: OverviewAction[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-950 dark:text-white">À faire</h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Priorisé par urgence opérationnelle.</p>
      </div>
      {actions.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
          <IconCheck size={16} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> Tout est à jour
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {actions.map((action) => (
            <Link
              key={action.id}
              href={action.href}
              className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] dark:hover:bg-white/5"
            >
              <span className={`shrink-0 rounded-md px-2 py-1 text-2xs font-semibold ${actionToneClass[action.tone]}`}>{action.kind}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{action.label}</span>
                {action.detail && <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">{action.detail}</span>}
              </span>
              <IconArrowRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

const EVENT_STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  published: 'Publié',
  closed: 'Clôturé',
  cancelled: 'Annulé',
};

const EVENT_STATUS_CLASS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  published: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  closed: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  cancelled: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

export function UpcomingEvents({ events }: { events: OverviewEvent[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-gray-950 dark:text-white">Prochains événements</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Les plus proches en premier.</p>
        </div>
        <Link href="/admin/evenementiel/evenements" className="text-xs font-semibold text-[var(--color-primary-dark)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
          Tous les événements
        </Link>
      </div>
      {events.length === 0 ? (
        <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">Aucun événement à venir</div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {events.map((event) => {
            const reserved = Math.max(0, event.capacity_total - event.capacity_remaining);
            const ratio = event.capacity_total > 0 ? Math.min(100, Math.round((reserved / event.capacity_total) * 100)) : 0;
            return (
              <Link
                key={event.id}
                href={`/admin/evenementiel/evenements/${event.id}`}
                className="block px-4 py-3 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] dark:hover:bg-white/5"
              >
                <div className="flex items-start gap-3">
                  <IconCalendarEvent size={18} className="mt-0.5 shrink-0 text-gray-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{event.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${EVENT_STATUS_CLASS[event.status] ?? EVENT_STATUS_CLASS.draft}`}>{EVENT_STATUS_LABEL[event.status] ?? event.status}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {new Date(event.date_start).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${ratio}%` }} />
                      </div>
                      <span className="shrink-0 text-xs font-medium tabular-nums text-gray-600 dark:text-gray-300">{reserved} / {event.capacity_total} places</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function RecentInquiries({ inquiries }: { inquiries: OverviewInquiry[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-gray-950 dark:text-white">Demandes récentes</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Derniers contacts entrants.</p>
        </div>
        <Link href="/admin/evenementiel/devis" className="text-xs font-semibold text-[var(--color-primary-dark)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
          Voir le pipeline
        </Link>
      </div>
      {inquiries.length === 0 ? (
        <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">Aucune nouvelle demande</div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {inquiries.map((inquiry) => (
            <div key={inquiry.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <IconFileDescription size={17} className="mt-0.5 shrink-0 text-gray-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{inquiry.customer_name}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{inquiry.service_offerings?.title ?? 'Service'}</p>
                    </div>
                    <span className="text-2xs font-semibold text-gray-500 dark:text-gray-400">{inquiry.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {inquiry.date_souhaitee ? `Souhaité le ${new Date(inquiry.date_souhaitee).toLocaleDateString('fr-FR')}` : 'Date à préciser'}
                    {inquiry.nombre_invites ? ` · ${inquiry.nombre_invites} invités` : ''}
                  </p>
                  <p className="mt-1 text-2xs text-gray-400">Reçue le {new Date(inquiry.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function UpcomingRentals({ rentals }: { rentals: OverviewRental[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-gray-950 dark:text-white">Locations à préparer</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Retraits confirmés à venir.</p>
        </div>
        <Link href="/admin/evenementiel/reservations-materiel" className="text-xs font-semibold text-[var(--color-primary-dark)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
          Planning
        </Link>
      </div>
      {rentals.length === 0 ? (
        <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">Aucune location à préparer</div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {rentals.map((rental) => {
            const summary = rental.items.length > 0
              ? rental.items.slice(0, 3).map((item) => `${item.quantity}× ${item.rental_items?.name ?? 'Article'}`).join(' · ')
              : 'Articles réservés';
            return (
              <Link
                key={rental.id}
                href="/admin/evenementiel/reservations-materiel"
                className="flex min-h-14 items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] dark:hover:bg-white/5"
              >
                <div className="w-14 shrink-0 rounded-lg bg-gray-50 px-2 py-1.5 text-center dark:bg-gray-800">
                  <p className="text-2xs font-semibold uppercase text-gray-500 dark:text-gray-400">{new Date(rental.pickup_date).toLocaleDateString('fr-FR', { month: 'short' })}</p>
                  <p className="text-lg font-semibold leading-5 text-gray-900 dark:text-gray-100">{new Date(rental.pickup_date).getDate()}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <IconPackage size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{rental.customer_name}</p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{summary}</p>
                  <p className="mt-1 flex items-center gap-1 text-2xs font-medium text-emerald-700 dark:text-emerald-300"><IconClock size={11} aria-hidden="true" /> Confirmée</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
