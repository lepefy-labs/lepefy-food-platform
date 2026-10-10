import { Suspense } from 'react';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import {
  CARD_PAYMENTS_PAGE_SIZE, cardPaymentsQueryString, parseCardPaymentsState, referenceRange, shopDay,
  type CardPaymentPeriod, type CardPaymentsListState,
} from '@/lib/card/cardPaymentsAdmin';
import { loadCardPaymentsList, type CardPaymentsListResult } from '@/lib/card/cardPaymentsList';
import { pageWindow } from '@/lib/admin/listParams';
import { formatDate, formatMoney, formatNumber, pluralize } from '@/lib/admin/format';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import AdminStatCard from '../../_components/ui/AdminStatCard';
import { ButtonLink } from '../../_components/ui/Button';
import InlineAlert from '../../_components/ui/InlineAlert';
import { Card } from '../../_components/ui/Panel';
import { ErrorState } from '../../_components/ui/States';
import FilterBar, { type ActiveFilterChip } from '../../_components/data/FilterBar';
import Pagination from '../../_components/data/Pagination';
import CardPaymentsList from './CardPaymentsList';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PERIODS: Array<[Exclude<CardPaymentPeriod, 'custom'>, string]> = [['today', 'Aujourd’hui'], ['7d', '7 jours'], ['30d', '30 jours'], ['all', 'Tout']];
const PERIOD_LABEL: Record<Exclude<CardPaymentPeriod, 'custom'>, string> = { today: 'aujourd’hui', '7d': '7 jours', '30d': '30 jours', all: 'depuis le début' };

// `YYYY-MM-DD` -> `29/09` (or `29/09/2025` outside the current year).
const shortDay = (day: string, today: string) => {
  const [y, m, d] = day.split('-');
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
};

// Access (orders.view) is enforced by the protected layout (adminRoutePermissions)
// and by the API; orders.manage only unlocks « Renvoyer la confirmation ».
// The list state (period, dates, status, search, page) lives in the URL and the
// server renders the list; a date picked in the filters panel switches to a
// custom period.
export default async function CardPaymentsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const get = (name: string) => { const value = searchParams[name]; return (Array.isArray(value) ? value[0] : value) ?? null; };
  const state = parseCardPaymentsState({ get: (name) => (name === 'period' && (get('from') || get('to')) ? 'custom' : get(name)) });
  const now = new Date();

  const [access, list] = await Promise.all([
    getCurrentAdminAccessContext(tenant.id),
    loadCardPaymentsList(createServiceClient(), tenant, state, now)
      .catch((error: unknown): CardPaymentsListResult | null => { console.error('[admin/card-payments] list unavailable', error); return null; }),
  ]);
  const canResend = access ? canAdmin(access, 'orders.manage') : false;

  const href = (patch: Partial<CardPaymentsListState>) => {
    const query = cardPaymentsQueryString({ ...state, page: 1, ...patch });
    return query ? `/admin/paiements-carte?${query}` : '/admin/paiements-carte';
  };
  const today = shopDay(now);
  const referenceSearch = referenceRange(state.q) !== null;
  const { period, from, to, status } = state;
  const periodLabel = period !== 'custom' ? PERIOD_LABEL[period]
    : from && to ? `${shortDay(from <= to ? from : to, today)} – ${shortDay(from <= to ? to : from, today)}`
    : from ? `depuis le ${shortDay(from, today)}`
    : to ? `jusqu’au ${shortDay(to, today)}`
    : 'depuis le début';
  const statusHref = (value: CardPaymentsListState['status']) => href({ status: status === value ? 'all' : value });
  const chips: ActiveFilterChip[] = [
    ...(period === 'custom' ? [{ key: 'period', label: `Période : ${periodLabel}`, href: href({ period: '7d', from: '', to: '' }) }] : []),
    ...(status !== 'all' ? [{ key: 'status', label: status === 'paid' ? 'Payés' : 'En cours / non finalisés', href: href({ status: 'all' }) }] : []),
  ];
  const total = list?.total ?? 0;
  const currency = list?.currency ?? tenant.currency ?? 'EUR';
  // A reference search opens its single result directly.
  const autoOpenId = referenceSearch && list?.payments.length === 1 ? list.payments[0]!.id : null;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminPageHeader
        title="Paiements carte"
        meta={list ? `Mis à jour à ${formatDate(now, 'time')}` : undefined}
        description="Paiements à montant libre effectués depuis la carte digitale (/card). La référence CP-… est celle affichée au client et dans son email."
        actions={<ButtonLink href={href({ page: state.page })}>Actualiser</ButtonLink>}
      />

      {list && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AdminStatCard title={`Encaissé · ${referenceSearch ? 'recherche' : periodLabel}`} value={formatMoney(list.summary.paidAmount, currency)} href={statusHref('paid')} active={status === 'paid'} tone="success" />
          <AdminStatCard title="Paiements payés" value={formatNumber(list.summary.paidCount)} href={statusHref('paid')} active={status === 'paid'} />
          <AdminStatCard title="Non finalisés" value={formatNumber(list.summary.abandonedCount)} description="Plus d’une heure sans paiement" href={statusHref('unfinished')} active={status === 'unfinished'} tone={list.summary.abandonedCount > 0 ? 'warning' : 'neutral'} />
        </div>
      )}
      {list?.summary.truncated && (
        <InlineAlert tone="warning" className="mb-4">Totaux partiels : calculés sur les 5 000 premiers paiements de la période. Réduisez la période pour un total exact.</InlineAlert>
      )}

      <Card as="section" className="overflow-hidden">
        <h2 className="sr-only">Liste des paiements carte</h2>
        <Suspense fallback={<div className="h-14 border-b border-a-border" />}>
          <FilterBar
            viewsLabel="Période"
            views={[
              ...PERIODS.map(([value, label]) => ({ key: value, label, active: period === value, href: href({ period: value, from: '', to: '' }) })),
              { key: 'custom', label: 'Personnalisé', active: period === 'custom', href: href({ period: 'custom', from: from || `${today.slice(0, 8)}01`, to: to || today }) },
            ]}
            search={{ label: 'Rechercher un paiement', placeholder: 'CP-A82F31, nom ou email' }}
            filters={[
              { type: 'select', key: 'status', label: 'Statut', allLabel: 'Tous les statuts', options: [{ value: 'paid', label: 'Payés' }, { value: 'unfinished', label: 'En cours / non finalisés' }] },
              { type: 'date-range', label: 'Période personnalisée', fromKey: 'from', toKey: 'to' },
            ]}
            activeChips={chips}
            resetHref="/admin/paiements-carte"
            resultLabel={referenceSearch ? `${pluralize(total, 'paiement')} · toutes les dates` : pluralize(total, 'paiement')}
          />
        </Suspense>
        {!list
          ? <ErrorState title="Impossible de charger les paiements." action={<ButtonLink href={href({ page: state.page })}>Réessayer</ButtonLink>} />
          : <CardPaymentsList key={autoOpenId ?? 'list'} payments={list.payments} canResend={canResend} autoOpenId={autoOpenId} searched={Boolean(state.q)} resetHref="/admin/paiements-carte" />}
        {list && total > 0 && <Pagination window={pageWindow(total, list.page, CARD_PAYMENTS_PAGE_SIZE)} noun="paiements" hrefForPage={(page) => href({ page })} />}
      </Card>
    </div>
  );
}
