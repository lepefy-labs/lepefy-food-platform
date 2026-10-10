import Link from 'next/link';
import { Suspense } from 'react';
import { IconAlertTriangle, IconSpeakerphone, IconUserCheck, IconUserPlus, IconUsers, IconUsersGroup } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { getCrmKpis, getCustomers, RFM_LABELS, SYSTEM_SEGMENTS } from '@/lib/admin/crm';
import { CUSTOMER_SORT_OPTIONS, CUSTOMER_SOURCE_OPTIONS, parseCustomerSort } from '@/lib/admin/crmLabels';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { defineListParams, pageWindow } from '@/lib/admin/listParams';
import { formatDate, formatMoney, formatNumber, formatRelative, pluralize } from '@/lib/admin/format';
import { createServiceClient } from '@/lib/supabase/server';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import AdminStatCard from '../../_components/ui/AdminStatCard';
import Badge from '../../_components/ui/Badge';
import { ButtonLink, buttonClasses } from '../../_components/ui/Button';
import { Card } from '../../_components/ui/Panel';
import { EmptyState } from '../../_components/ui/States';
import DataTable, { type DataColumn } from '../../_components/data/DataTable';
import FilterBar, { type ActiveFilterChip } from '../../_components/data/FilterBar';
import Pagination from '../../_components/data/Pagination';
import { ClientsToolbar } from './ClientsToolbar';

export const dynamic = 'force-dynamic'; export const fetchCache = 'force-no-store';

const QUICK_SEGMENTS = ['all', 'active', 'new', 'loyal', 'vip', 'at_risk', 'inactive', 'marketing'];

const CLIENT_LIST = defineListParams({
  q: { type: 'search' },
  segment: { type: 'string', maxLength: 64 },
  source: { type: 'enum', values: CUSTOMER_SOURCE_OPTIONS.map((option) => option.value) },
  marketing: { type: 'bool' },
  loyalty: { type: 'bool' },
  minOrders: { type: 'int', min: 0, max: 100000 },
  minLifetimeValue: { type: 'int', min: 0, max: 10000000 },
  createdAfter: { type: 'date' },
  createdBefore: { type: 'date' },
  lastPurchaseBefore: { type: 'date' },
  tagId: { type: 'uuid' },
  sort: { type: 'enum', values: CUSTOMER_SORT_OPTIONS.map((option) => option.key), default: 'last_activity' },
}, { pageSizes: [25, 50, 100], defaultPageSize: 25 });

type Customer = Awaited<ReturnType<typeof getCustomers>>['customers'][number];

const initials = (value: string) => value.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
const dateLabel = (value?: string) => (value ? formatDate(value) : '');

export default async function ClientsPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const values = CLIENT_LIST.parse(searchParams);
  const { sort, direction } = parseCustomerSort(values.sort);
  const db = createServiceClient();
  const [result, kpis, tagsResult, segmentsResult, access] = await Promise.all([
    getCustomers(tenant.id, {
      q: values.q, segment: values.segment, source: values.source, marketing: values.marketing, loyalty: values.loyalty,
      minOrders: values.minOrders, minLifetimeValue: values.minLifetimeValue, createdAfter: values.createdAfter,
      createdBefore: values.createdBefore, lastPurchaseBefore: values.lastPurchaseBefore, tagId: values.tagId,
      page: values.page, pageSize: values.pageSize, sort, direction,
    }),
    getCrmKpis(tenant.id),
    db.from('customer_tags').select('id,name').eq('tenant_id', tenant.id).order('name'),
    db.from('customer_segments').select('id,name').eq('tenant_id', tenant.id).eq('kind', 'custom').eq('active', true).order('name'),
    getCurrentAdminAccessContext(tenant.id),
  ]);
  // UI hint only: write routes re-check customers.manage.
  const canManage = Boolean(access && canAdmin(access, 'customers.manage'));
  const now = new Date();
  const href = (patch: Parameters<typeof CLIENT_LIST.href>[2]) => CLIENT_LIST.href('/admin/clients', values, patch);
  const window = pageWindow(result.count, result.page, values.pageSize);
  const activeSegment = values.segment ?? 'all';
  const tags = (tagsResult.data ?? []) as { id: string; name: string }[];
  const customSegments = (segmentsResult.data ?? []) as { id: string; name: string }[];
  const hasFilters = CLIENT_LIST.activeCount(values, ['segment', 'source', 'marketing', 'loyalty', 'minOrders', 'minLifetimeValue', 'createdAfter', 'createdBefore', 'lastPurchaseBefore', 'tagId']) > 0 || Boolean(values.q);
  const resetHref = CLIENT_LIST.href('/admin/clients', { ...CLIENT_LIST.parse({}), sort: values.sort, pageSize: values.pageSize }, {});
  const segmentName = (key: string) => SYSTEM_SEGMENTS.find((segment) => segment.key === key)?.name ?? customSegments.find((segment) => segment.id === key)?.name ?? key;

  // Each KPI opens the matching segment (same definitions as the segment views).
  const cards = [
    { label: 'Clients', value: kpis.total, segment: 'all', tone: 'neutral' as const, icon: IconUsers },
    { label: 'Clients actifs · 90 j', value: kpis.active, segment: 'active', tone: 'success' as const, icon: IconUserCheck },
    { label: 'Nouveaux', value: kpis.new, segment: 'new', tone: 'info' as const, icon: IconUserPlus },
    { label: 'À risque', value: kpis.atRisk, segment: 'at_risk', tone: 'warning' as const, icon: IconAlertTriangle },
  ];
  const chips: ActiveFilterChip[] = [
    ...(values.segment && !QUICK_SEGMENTS.includes(values.segment) ? [{ key: 'segment', label: `Segment : ${segmentName(values.segment)}`, href: href({ segment: undefined }) }] : []),
    ...(values.source ? [{ key: 'source', label: `Source : ${CUSTOMER_SOURCE_OPTIONS.find((option) => option.value === values.source)?.label ?? values.source}`, href: href({ source: undefined }) }] : []),
    ...(values.marketing !== undefined ? [{ key: 'marketing', label: values.marketing ? 'Marketing autorisé' : 'Marketing non autorisé', href: href({ marketing: undefined }) }] : []),
    ...(values.loyalty !== undefined ? [{ key: 'loyalty', label: values.loyalty ? 'Avec solde fidélité' : 'Sans solde fidélité', href: href({ loyalty: undefined }) }] : []),
    ...(values.minOrders !== undefined ? [{ key: 'minOrders', label: `≥ ${pluralize(values.minOrders, 'commande')}`, href: href({ minOrders: undefined }) }] : []),
    ...(values.minLifetimeValue !== undefined ? [{ key: 'minLifetimeValue', label: `Dépensé ≥ ${formatMoney(values.minLifetimeValue, tenant.currency)}`, href: href({ minLifetimeValue: undefined }) }] : []),
    ...(values.tagId ? [{ key: 'tagId', label: `Tag : ${tags.find((tag) => tag.id === values.tagId)?.name ?? '?'}`, href: href({ tagId: undefined }) }] : []),
    ...(values.createdAfter ? [{ key: 'createdAfter', label: `Créé après le ${dateLabel(values.createdAfter)}`, href: href({ createdAfter: undefined }) }] : []),
    ...(values.createdBefore ? [{ key: 'createdBefore', label: `Créé avant le ${dateLabel(values.createdBefore)}`, href: href({ createdBefore: undefined }) }] : []),
    ...(values.lastPurchaseBefore ? [{ key: 'lastPurchaseBefore', label: `Dernier achat avant le ${dateLabel(values.lastPurchaseBefore)}`, href: href({ lastPurchaseBefore: undefined }) }] : []),
  ];
  const name = (c: Customer) => c.full_name ?? c.email ?? c.phone ?? 'Client';

  const columns: DataColumn<Customer>[] = [
    { key: 'client', header: 'Client', className: 'min-w-[220px]', cell: (c) => (
      <Link href={`/admin/clients/${c.id}`} className="flex items-center gap-3 font-semibold hover:underline">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-a-brand-soft text-xs font-semibold text-a-brand-fg">{initials(c.full_name ?? c.email ?? '?')}</span>
        <span className="truncate">{name(c)}</span>
      </Link>
    ) },
    { key: 'contact', header: 'Contact', cell: (c) => <div className="text-xs text-a-text-2"><p className="truncate">{c.email ?? 'E-mail absent'}</p>{c.phone && <p>{c.phone}</p>}</div> },
    { key: 'segment', header: 'Segment', cell: (c) => <Badge tone="brand">{RFM_LABELS[c.rfm_segment]}</Badge> },
    { key: 'orders', header: 'Commandes', align: 'right', cell: (c) => formatNumber(c.completed_orders_count) },
    { key: 'spent', header: 'Dépensé', align: 'right', cell: (c) => <span className="font-semibold">{formatMoney(c.lifetime_value, tenant.currency)}</span> },
    { key: 'aov', header: 'Panier moyen', align: 'right', hideBelow: 'xl', cell: (c) => formatMoney(c.average_order_value, tenant.currency) },
    { key: 'last', header: 'Dernier achat', cell: (c) => (c.last_order_at ? <time dateTime={c.last_order_at} title={formatDate(c.last_order_at)}>{formatRelative(c.last_order_at, now)}</time> : <span className="text-a-text-3">Jamais</span>) },
    { key: 'loyalty', header: 'Fidélité', align: 'right', hideBelow: 'lg', cell: (c) => `${formatNumber(c.loyalty_points_balance)} pts` },
    { key: 'marketing', header: 'Marketing', cell: (c) => (c.marketing_consent ? <Badge tone="success">Autorisé</Badge> : <Badge tone="neutral">Non autorisé</Badge>) },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl">
      <AdminPageHeader
        title="Clients"
        meta={pluralize(kpis.total, 'client')}
        description="Comprendre et fidéliser votre clientèle."
        actions={<>
          <ButtonLink href="/admin/clients/segments"><IconUsersGroup size={17} aria-hidden="true" />Segments</ButtonLink>
          <ButtonLink href="/admin/clients/campagnes"><IconSpeakerphone size={17} aria-hidden="true" />Campagnes</ButtonLink>
          <Suspense fallback={null}><ClientsToolbar canManage={canManage} /></Suspense>
        </>}
      />
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map((card) => (
          <AdminStatCard key={card.label} title={card.label} value={formatNumber(card.value)} tone={card.tone} icon={card.icon}
            href={href({ segment: card.segment === 'all' ? undefined : card.segment })} active={activeSegment === card.segment && card.segment !== 'all'} />
        ))}
      </div>
      <Card as="section" className="overflow-hidden">
        <h2 className="sr-only">Liste des clients</h2>
        <Suspense fallback={<div className="h-14 border-b border-a-border" />}>
          <FilterBar
            viewsLabel="Segments rapides"
            views={SYSTEM_SEGMENTS.filter((segment) => QUICK_SEGMENTS.includes(segment.key)).map((segment) => ({
              key: segment.key, label: segment.name, active: activeSegment === segment.key,
              href: href({ segment: segment.key === 'all' ? undefined : segment.key }),
            }))}
            search={{ label: 'Rechercher un client', placeholder: 'Nom, e-mail, téléphone, carte…' }}
            filters={[
              { type: 'select', key: 'segment', label: 'Segment', allLabel: 'Tous les segments', options: [...SYSTEM_SEGMENTS.filter((segment) => segment.key !== 'all').map((segment) => ({ value: segment.key, label: segment.name })), ...customSegments.map((segment) => ({ value: segment.id, label: segment.name }))] },
              { type: 'select', key: 'source', label: 'Source', allLabel: 'Toutes les sources', options: CUSTOMER_SOURCE_OPTIONS.map((option) => ({ value: option.value, label: option.label })) },
              { type: 'select', key: 'marketing', label: 'Consentement marketing', allLabel: 'Tout consentement', options: [{ value: 'true', label: 'Marketing autorisé' }, { value: 'false', label: 'Marketing non autorisé' }] },
              { type: 'select', key: 'loyalty', label: 'Fidélité', allLabel: 'Toute fidélité', options: [{ value: 'true', label: 'Avec solde fidélité' }, { value: 'false', label: 'Sans solde fidélité' }] },
              ...(tags.length > 0 ? [{ type: 'select' as const, key: 'tagId', label: 'Tag', allLabel: 'Tous les tags', options: tags.map((tag) => ({ value: tag.id, label: tag.name })) }] : []),
              { type: 'number', key: 'minOrders', label: 'Commandes minimum', min: 0, step: 1 },
              { type: 'number', key: 'minLifetimeValue', label: 'Montant dépensé minimum (€)', min: 0, step: 1 },
              { type: 'date-range', label: 'Date de création', fromKey: 'createdAfter', toKey: 'createdBefore' },
              { type: 'date', key: 'lastPurchaseBefore', label: 'Dernier achat avant le' },
            ]}
            activeChips={chips}
            resetHref={resetHref}
            sort={{ value: values.sort ?? 'last_activity', options: CUSTOMER_SORT_OPTIONS.map((option) => ({ value: option.key, label: option.label })) }}
            resultLabel={pluralize(result.count, 'client')}
          />
        </Suspense>
        <DataTable<Customer>
          caption={`Clients, triés par ${CUSTOMER_SORT_OPTIONS.find((option) => option.key === sort)!.label.toLowerCase()}`}
          columns={columns}
          rowKey={(c) => c.id}
          rows={result.customers}
          mobileCard={(c) => (
            <Link href={`/admin/clients/${c.id}`} className="block p-3 text-sm">
              <div className="flex justify-between gap-3">
                <div className="min-w-0"><p className="truncate font-semibold">{name(c)}</p><p className="truncate text-xs text-a-text-2">{c.email ?? c.phone ?? 'Aucun contact'}</p></div>
                <Badge tone="brand">{RFM_LABELS[c.rfm_segment]}</Badge>
              </div>
              <p className="mt-2 font-semibold">{formatMoney(c.lifetime_value, tenant.currency)} · {pluralize(c.completed_orders_count, 'commande')}</p>
              <p className="mt-0.5 text-xs text-a-text-3">Dernier achat · {c.last_order_at ? formatRelative(c.last_order_at, now) : 'jamais'}</p>
              <div className="mt-2 flex justify-between text-xs text-a-text-2"><span>{formatNumber(c.loyalty_points_balance)} pts</span><span>Marketing {c.marketing_consent ? 'autorisé' : 'non autorisé'}</span></div>
            </Link>
          )}
          empty={hasFilters
            ? <EmptyState variant="filtered" title="Aucun client ne correspond à ces filtres." description="Modifiez ou réinitialisez les filtres pour élargir la recherche." action={<Link href={resetHref} className={buttonClasses({ variant: 'secondary' })}>Réinitialiser les filtres</Link>} />
            : <EmptyState title="Aucun client pour le moment" description="Les clients apparaîtront ici après une commande, une inscription ou un ajout manuel." action={canManage ? <Link href="/admin/clients?new=1" className={buttonClasses()}>Ajouter un client</Link> : undefined} />}
        />
        {result.count > 0 && <Pagination window={window} noun="clients" hrefForPage={(page) => href({ page })} hrefForPageSize={(pageSize) => href({ pageSize })} pageSizes={CLIENT_LIST.pageSizes} />}
      </Card>
    </div>
  );
}
