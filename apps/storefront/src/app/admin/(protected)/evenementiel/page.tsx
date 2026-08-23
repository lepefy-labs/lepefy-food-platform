import Link from 'next/link';
import { IconChevronDown, IconPlus } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { getEvenementielOverview } from '@/lib/admin/evenementiel/getEvenementielOverview';
import {
  EventActionList,
  OverviewMetricCard,
  RecentInquiries,
  UpcomingEvents,
  UpcomingRentals,
} from './_components/OverviewSections';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
}

export default async function AdminEvenementielOverviewPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const overview = await getEvenementielOverview(tenant.id, tenant.currency);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="hidden text-xl font-semibold text-gray-950 dark:text-white sm:block">Événementiel</h1>
          <h1 className="text-xl font-semibold text-gray-950 dark:text-white sm:hidden">Vue d’ensemble</h1>
          <p className="mt-1 hidden text-sm text-gray-500 dark:text-gray-400 sm:block">
            Pilotez vos événements, demandes et locations depuis un seul endroit.
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 sm:hidden">Ce qui demande votre attention.</p>
        </div>

        <details className="relative self-start">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg bg-[var(--color-primary)] px-3.5 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 dark:ring-offset-gray-950">
            <IconPlus size={15} aria-hidden="true" />
            Créer
            <IconChevronDown size={13} aria-hidden="true" />
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-800 dark:bg-gray-900">
            <Link href="/admin/evenementiel/evenements" className="flex min-h-11 items-center rounded-lg px-3 text-sm text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:text-gray-200 dark:hover:bg-white/5">
              Nouvel événement
            </Link>
            <Link href="/admin/evenementiel/services" className="flex min-h-11 items-center rounded-lg px-3 text-sm text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:text-gray-200 dark:hover:bg-white/5">
              Nouveau service
            </Link>
          </div>
        </details>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OverviewMetricCard label="À traiter" value={overview.newInquiriesCount} tone={overview.newInquiriesCount > 0 ? 'amber' : 'neutral'} />
        <OverviewMetricCard
          label="Paiements à vérifier"
          value={overview.pendingPaymentsCount}
          detail={overview.pendingPaymentsCount > 0 ? formatAmount(overview.pendingPaymentsAmount, tenant.currency) : undefined}
          tone={overview.pendingPaymentsCount > 0 ? 'amber' : 'neutral'}
        />
        <OverviewMetricCard label="Prochains événements" value={overview.upcomingEventsCount} tone="green" />
        <OverviewMetricCard label="Locations à préparer" value={overview.upcomingRentalCount} tone={overview.upcomingRentalCount > 0 ? 'amber' : 'neutral'} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,.9fr)]">
        <div className="space-y-4">
          <EventActionList actions={overview.actions} />
          <UpcomingEvents events={overview.upcomingEvents} />
        </div>
        <div className="space-y-4">
          <RecentInquiries inquiries={overview.recentInquiries} />
          <UpcomingRentals rentals={overview.upcomingRentals} />
        </div>
      </div>
    </div>
  );
}
