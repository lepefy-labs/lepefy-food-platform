import Link from 'next/link';
import { IconCalendarEvent, IconChevronDown, IconPlus, IconScan } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { getEvenementielOverview } from '@/lib/admin/evenementiel/getEvenementielOverview';
import { EventActionList, OverviewMetricCard, RecentInquiries, UpcomingRentals } from './_components/OverviewSections';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
}

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default async function AdminEvenementielOverviewPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const overview = await getEvenementielOverview(tenant.id, tenant.currency);
  const nextEvent = overview.upcomingEvents[0] ?? null;
  const reserved = nextEvent ? Math.max(0, nextEvent.capacity_total - nextEvent.capacity_remaining) : 0;
  const progress = nextEvent && nextEvent.capacity_total > 0
    ? Math.min(100, Math.round((reserved / nextEvent.capacity_total) * 100))
    : 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-950 dark:text-white">Événementiel</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Pilotez les événements et le service sur place depuis un seul espace.
          </p>
        </div>
        <details className="relative self-start">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
            <IconPlus size={15} />
            Créer
            <IconChevronDown size={13} />
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-800 dark:bg-gray-900">
            <Link href="/admin/evenementiel/evenements" className="flex min-h-11 items-center rounded-lg px-3 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5">
              Nouvel événement
            </Link>
            <Link href="/admin/evenementiel/services" className="flex min-h-11 items-center rounded-lg px-3 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/5">
              Nouveau service
            </Link>
          </div>
        </details>
      </header>

      {nextEvent ? (
        <section className="overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-white via-white to-violet-50 shadow-sm dark:border-violet-900/60 dark:from-gray-900 dark:via-gray-900 dark:to-violet-950/20">
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-6">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-300">
                <IconCalendarEvent size={16} />
                Prochain événement
              </p>
              <h2 className="mt-2 truncate text-2xl font-bold text-gray-950 dark:text-white">{nextEvent.title}</h2>
              <p className="mt-1 text-sm capitalize text-gray-500 dark:text-gray-400">{formatEventDate(nextEvent.date_start)}</p>

              <div className="mt-4 max-w-2xl">
                <div className="mb-1.5 flex items-center justify-between text-xs text-gray-500">
                  <span>{reserved} / {nextEvent.capacity_total} places réservées</span>
                  <span>{nextEvent.capacity_remaining} restantes</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div className="h-full rounded-full bg-[var(--admin-primary)]" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Link href={`/admin/evenementiel/evenements/${nextEvent.id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                  Gérer l’événement
                </Link>
                <Link href={`/scan?event_id=${nextEvent.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white shadow-sm hover:opacity-95">
                  <IconScan size={18} />
                  Ouvrir le service repas
                </Link>
              </div>
            </div>

            <div className="hidden min-w-36 rounded-2xl border border-violet-100 bg-white/85 p-4 text-center shadow-sm dark:border-violet-900/50 dark:bg-gray-900/70 lg:block">
              <p className="text-3xl font-black text-gray-950 dark:text-white">{reserved}</p>
              <p className="mt-1 text-xs text-gray-500">places réservées</p>
              <p className="mt-3 text-xs font-semibold text-violet-600 dark:text-violet-300">{progress}% rempli</p>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
          <p className="font-semibold text-gray-900 dark:text-white">Aucun événement publié à venir</p>
          <p className="mt-1 text-sm text-gray-500">Créez ou publiez un événement pour préparer le prochain service.</p>
          <Link href="/admin/evenementiel/evenements" className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white">
            Gérer les événements
          </Link>
        </section>
      )}

      <section className="grid grid-cols-3 gap-2 sm:gap-3">
        <OverviewMetricCard
          label="Paiements"
          value={overview.pendingPaymentsCount}
          detail={overview.pendingPaymentsCount > 0 ? formatAmount(overview.pendingPaymentsAmount, tenant.currency) : undefined}
          tone={overview.pendingPaymentsCount > 0 ? 'amber' : 'neutral'}
        />
        <OverviewMetricCard label="Demandes" value={overview.newInquiriesCount} tone={overview.newInquiriesCount > 0 ? 'amber' : 'neutral'} />
        <OverviewMetricCard label="Locations" value={overview.upcomingRentalCount} tone={overview.upcomingRentalCount > 0 ? 'amber' : 'neutral'} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,.9fr)]">
        <div className="space-y-4">
          <EventActionList actions={overview.actions} />
          <div className="flex justify-end">
            <Link href="/admin/evenementiel/evenements" className="text-sm font-semibold text-[var(--admin-primary-fg)] hover:underline">
              Voir tous les événements →
            </Link>
          </div>
        </div>
        <div className="space-y-4">
          <RecentInquiries inquiries={overview.recentInquiries} />
          <UpcomingRentals rentals={overview.upcomingRentals} />
        </div>
      </div>
    </div>
  );
}
