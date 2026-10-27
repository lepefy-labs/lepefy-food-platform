import { IconAlertTriangle, IconCalendarDue, IconCircleCheck, IconPlayerPause, IconQuestionMark } from '@tabler/icons-react';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import AdminStatCard from '../../../_components/ui/AdminStatCard';
import { loadPlatformSubscriptions } from '@/lib/billing/platformSubscriptions';
import { subscriptionState, type SubscriptionStateKind } from '@/lib/billing/subscriptionRules';
import { SUBSCRIPTION_STATE_META } from '@/lib/admin/statusRegistry';
import AbonnementsClient from './AbonnementsClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PATH = '/admin/platform/abonnements';

/** Counters in the order of urgency; each one is a URL filter (a second click clears it). */
const VIEWS: Array<{ kind: SubscriptionStateKind; title: string; icon: typeof IconCircleCheck }> = [
  { kind: 'overdue', title: 'En retard', icon: IconAlertTriangle },
  { kind: 'due_soon', title: 'Échéance ≤ 7 jours', icon: IconCalendarDue },
  { kind: 'suspended', title: 'Suspendus', icon: IconPlayerPause },
  { kind: 'active', title: 'À jour', icon: IconCircleCheck },
  { kind: 'undefined', title: 'Sans échéance', icon: IconQuestionMark },
];

function parseView(value: string | string[] | undefined): SubscriptionStateKind | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return VIEWS.some((view) => view.kind === raw) ? (raw as SubscriptionStateKind) : null;
}

// platform/layout.tsx already restricts this page to platform_owner; the API
// routes re-check with requirePlatformOwner().
export default async function PlatformSubscriptionsPage({ searchParams }: { searchParams: { vue?: string | string[] } }) {
  const data = await loadPlatformSubscriptions().catch((error) => {
    console.error('[platform/abonnements] load failed', error);
    return null;
  });
  const view = parseView(searchParams.vue);
  const now = new Date();
  const withState = (data?.rows ?? []).map((row) => ({
    row,
    kind: subscriptionState(row.hasSubscription ? {
      status: row.status, suspended_at: row.suspendedAt, suspension_mode: row.suspensionMode, paid_until: row.paidUntil, grace_days: row.graceDays,
    } : null, now).kind,
  }));
  const counts = Object.fromEntries(VIEWS.map(({ kind }) => [kind, withState.filter((item) => item.kind === kind).length])) as Record<SubscriptionStateKind, number>;
  const rows = withState.filter((item) => !view || item.kind === view).map((item) => item.row);

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <AdminPageHeader
        title="Abonnements"
        description="Échéances, rappels, paiements reçus et suspension de chaque tenant."
        meta={data ? `${data.rows.length} tenant${data.rows.length !== 1 ? 's' : ''}` : undefined}
      />
      {!data ? (
        <p className="rounded-xl border border-tone-danger-border bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">Abonnements indisponibles. Réessayez.</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {VIEWS.map(({ kind, title, icon }) => (
              <AdminStatCard
                key={kind}
                title={title}
                value={counts[kind]}
                tone={SUBSCRIPTION_STATE_META[kind].tone}
                icon={icon}
                active={view === kind}
                href={view === kind ? PATH : `${PATH}?vue=${kind}`}
              />
            ))}
          </div>
          <AbonnementsClient initialRows={rows} schemaReady={data.schemaReady} paypalUrl={data.paypalUrl} />
        </>
      )}
    </div>
  );
}
