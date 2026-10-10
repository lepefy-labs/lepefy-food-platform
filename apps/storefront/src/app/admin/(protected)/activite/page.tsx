import Link from 'next/link';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { IconAlertTriangle, IconDownload, IconHistory, IconUrgent, IconUsers } from '@tabler/icons-react';
import { notePrivilegedView, requireActivityJournalPage, resolveTenantView } from '@/lib/audit/access';
import {
  ACTIVITY_LIST, ACTIVITY_MAX_OFFSET, OUTCOME_OPTIONS, PERIOD_OPTIONS, activityCriteria, type ActivityListValues,
} from '@/lib/audit/activityListParams';
import { AUDIT_ACTOR_LABELS, AUDIT_RESOURCE_LABELS, auditEventOptions } from '@/lib/audit/eventCatalog';
import {
  AuditFeedUnavailable, buildFeedFilters, countFeed, listFeedActors, loadFeedEvent, loadFeedPage, moduleLabel, summarizeFeed,
  type AuditEventView, type FeedSummary,
} from '@/lib/audit/feed';
import { formatDate, formatNumber, formatRelative, pluralize } from '@/lib/admin/format';
import { pageWindow } from '@/lib/admin/listParams';
import { AUDIT_OUTCOME_META, statusMeta } from '@/lib/admin/statusRegistry';
import { createServiceClient } from '@/lib/supabase/server';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import AdminStatCard from '../../_components/ui/AdminStatCard';
import AdminTabs from '../../_components/ui/Tabs';
import Badge, { CountBadge } from '../../_components/ui/Badge';
import { ButtonAnchor, buttonClasses } from '../../_components/ui/Button';
import { Card } from '../../_components/ui/Panel';
import { EmptyState, ErrorState } from '../../_components/ui/States';
import InlineAlert from '../../_components/ui/InlineAlert';
import DataTable, { type DataColumn } from '../../_components/data/DataTable';
import FilterBar, { type ActiveFilterChip } from '../../_components/data/FilterBar';
import Pagination from '../../_components/data/Pagination';
import AuditChanges from '../../_components/data/AuditChanges';
import EventDetailDrawer from './_components/EventDetailDrawer';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PATH = '/admin/activite';
const TAB_LABELS = { activity: 'Activité', automation: 'Automatisations', security: 'Sécurité' } as const;
const DESCRIPTIONS = {
  activity: 'Qui a fait quoi, quand et sur quelle ressource.',
  automation: 'Synchronisations, envois et traitements automatiques, avec leurs échecs.',
  security: 'Rôles, accès des administrateurs et exports du journal.',
} as const;

export default async function ActivityJournalPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const context = await requireActivityJournalPage();
  const { scope } = context;
  let values = ACTIVITY_LIST.parse(searchParams);
  if (values.tab === 'security' && !scope.canSeeSecurity) redirect(PATH);
  const view = resolveTenantView(context, values.tenant);
  if (!scope.canSeePlatform) values = { ...values, tenant: undefined };

  const href = (patch: Parameters<typeof ACTIVITY_LIST.href>[2]) => ACTIVITY_LIST.href(PATH, values, patch);
  const now = new Date();
  const criteria = activityCriteria(values, now);
  const listFilters = buildFeedFilters(scope, view.tenants, criteria);
  const kpiFilters = buildFeedFilters(scope, view.tenants, activityCriteria(values, now, { ignoreOutcome: true }));
  const badgeFilters = buildFeedFilters(scope, view.tenants, { categories: ['automation'], from: criteria.from, to: criteria.to });
  const offset = (values.page - 1) * values.pageSize;

  let events: AuditEventView[] = [];
  let total = { total: 0, capped: false };
  let summary: FeedSummary | null = null;
  let automationFailures = 0;
  let actors: { id: string; label: string }[] = [];
  let detail: AuditEventView | null = null;
  let failure: AuditFeedUnavailable | null = null;
  try {
    const [page, count, kpis, badge, actorList, detailEvent] = await Promise.all([
      offset <= ACTIVITY_MAX_OFFSET ? loadFeedPage(listFilters, values.pageSize, offset) : Promise.resolve([]),
      countFeed(listFilters),
      summarizeFeed(kpiFilters),
      summarizeFeed(badgeFilters),
      listFeedActors(buildFeedFilters(scope, view.tenants, { categories: criteria.categories, from: criteria.from, to: criteria.to })),
      values.detail ? loadFeedEvent(scope, view.tenants, values.detail) : Promise.resolve(null),
    ]);
    events = page; total = count; summary = kpis; automationFailures = badge.automationFailures; actors = actorList; detail = detailEvent;
    await notePrivilegedView(context, view);
  } catch (error) {
    failure = error instanceof AuditFeedUnavailable ? error : new AuditFeedUnavailable(false);
  }

  const tenants = scope.canSeePlatform
    ? ((await createServiceClient().from('tenants').select('id, name').order('name')).data ?? []) as { id: string; name: string }[]
    : [];
  const tenantName = (id: string | null) => (id ? tenants.find((tenant) => tenant.id === id)?.name ?? id.slice(0, 8) : 'Plateforme');
  const allTenants = view.tenantId === null;

  const tabs = (['activity', 'automation', 'security'] as const)
    .filter((tab) => tab !== 'security' || scope.canSeeSecurity)
    .map((tab) => ({
      href: ACTIVITY_LIST.href(PATH, { ...values, tab, event: undefined, module: undefined, outcome: undefined, detail: undefined }, {}),
      label: TAB_LABELS[tab],
      active: values.tab === tab,
      badge: tab === 'automation' && automationFailures > 0 ? <CountBadge tone="danger" count={automationFailures} label="échecs" /> : undefined,
    }));

  const tabModules = scope.modules.filter((module) => {
    if (values.tab === 'security') return module === 'security' || module === 'audit';
    return module !== 'audit';
  });
  const periodLabel = PERIOD_OPTIONS.find((option) => option.value === values.period)?.label ?? '';
  const window = pageWindow(total.total, values.page, values.pageSize);
  const closeHref = href({ detail: undefined, page: values.page });
  const exportQuery = ACTIVITY_LIST.query({ ...values, page: 1, detail: undefined });
  const hasFilters = ACTIVITY_LIST.activeCount(values, ['module', 'event', 'actor', 'outcome', 'rt', 'corr', 'from', 'to']) > 0 || Boolean(values.q);
  const resetHref = ACTIVITY_LIST.href(PATH, { ...ACTIVITY_LIST.parse({}), tab: values.tab, tenant: values.tenant, pageSize: values.pageSize }, {});

  const chips: ActiveFilterChip[] = [
    ...(values.module ? [{ key: 'module', label: `Module : ${moduleLabel(values.module)}`, href: href({ module: undefined }) }] : []),
    ...(values.event ? [{ key: 'event', label: `Événement : ${auditEventOptions(scope.modules).find((option) => option.value === values.event)?.label ?? values.event}`, href: href({ event: undefined }) }] : []),
    ...(values.actor ? [{ key: 'actor', label: `Auteur : ${actors.find((actor) => actor.id === values.actor)?.label ?? 'administrateur'}`, href: href({ actor: undefined }) }] : []),
    ...(values.outcome ? [{ key: 'outcome', label: `Résultat : ${OUTCOME_OPTIONS.find((option) => option.value === values.outcome)?.label}`, href: href({ outcome: undefined }) }] : []),
    ...(values.rt && values.rid ? [{ key: 'rt', label: `${AUDIT_RESOURCE_LABELS[values.rt] ?? 'Ressource'} : ${values.rid.slice(0, 12)}`, href: href({ rt: undefined, rid: undefined }) }] : []),
    ...(values.corr ? [{ key: 'corr', label: `Même action : ${values.corr.slice(0, 12)}…`, href: href({ corr: undefined }) }] : []),
  ];

  const columns: DataColumn<AuditEventView>[] = [
    { key: 'date', header: 'Date', className: 'w-36', cell: (event) => (
      <time dateTime={event.occurredAt} title={formatDate(event.occurredAt, 'datetime')} className="whitespace-nowrap tabular-nums text-a-text-2">
        {formatDate(event.occurredAt, 'short')}
      </time>
    ) },
    { key: 'event', header: 'Événement', className: 'min-w-[240px]', cell: (event) => (
      <div className="min-w-0">
        <Link href={href({ detail: event.id, page: values.page })} scroll={false} className="font-semibold text-a-text hover:underline">{event.label}</Link>
        <p className="text-xs text-a-text-3">{event.moduleLabel}{allTenants ? ` · ${tenantName(event.tenantId)}` : ''}</p>
        <AuditChanges changes={event.changes.slice(0, 3)} compact className="mt-0.5" />
      </div>
    ) },
    { key: 'resource', header: 'Ressource', hideBelow: 'lg', cell: (event) => (
      event.resourceHref
        ? <Link href={event.resourceHref} className="font-medium text-a-brand-fg hover:underline">{event.resourceLabel ?? AUDIT_RESOURCE_LABELS[event.resourceType ?? ''] ?? 'Ouvrir'}</Link>
        : <span className="text-a-text-2">{event.resourceLabel ?? (event.resourceType ? AUDIT_RESOURCE_LABELS[event.resourceType] ?? event.resourceType : '—')}</span>
    ) },
    { key: 'actor', header: 'Auteur', cell: (event) => (
      <div className="min-w-0 text-sm">
        <p className={event.actorType === 'unknown' ? 'text-a-text-3' : 'text-a-text'}>{event.actorLabel ?? AUDIT_ACTOR_LABELS[event.actorType]}</p>
        {event.actorLabel && event.actorType !== 'admin' && <p className="text-xs text-a-text-3">{AUDIT_ACTOR_LABELS[event.actorType]}</p>}
      </div>
    ) },
    { key: 'outcome', header: 'Résultat', cell: (event) => {
      const meta = statusMeta(AUDIT_OUTCOME_META, event.outcome);
      return <Badge tone={meta.tone} dot>{meta.label}</Badge>;
    } },
  ];

  const kpiCard = (title: string, value: number, tone: 'neutral' | 'danger' | 'urgent' | 'info', icon: typeof IconHistory, outcome?: ActivityListValues['outcome']) => (
    <AdminStatCard title={title} value={formatNumber(value)} tone={tone} icon={icon}
      href={outcome ? href({ outcome: values.outcome === outcome ? undefined : outcome }) : undefined}
      active={Boolean(outcome) && values.outcome === outcome} />
  );

  return (
    <div className="mx-auto w-full max-w-7xl">
      <AdminPageHeader
        title="Journal d’activité"
        meta={allTenants ? 'Toutes les boutiques' : scope.canSeePlatform ? tenantName(view.tenantId) : periodLabel}
        description={DESCRIPTIONS[values.tab as keyof typeof DESCRIPTIONS]}
        actions={scope.canExport && !failure ? (
          <ButtonAnchor href={`/api/admin/activite/export${exportQuery ? `?${exportQuery}` : ''}`} download>
            <IconDownload size={17} aria-hidden="true" />Exporter CSV
          </ButtonAnchor>
        ) : undefined}
        tabs={<AdminTabs tabs={tabs} label="Sections du journal" />}
      />

      {scope.canSeePlatform && (
        <nav aria-label="Boutique consultée" className="mb-3 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-a-text-3">Boutique :</span>
          <Link href={href({ tenant: undefined })} aria-current={values.tenant === undefined ? 'true' : undefined}
            className={buttonClasses({ variant: values.tenant === undefined ? 'primary' : 'outline', size: 'sm' })}>{context.tenant.name}</Link>
          <Link href={href({ tenant: 'all' })} aria-current={allTenants ? 'true' : undefined}
            className={buttonClasses({ variant: allTenants ? 'primary' : 'outline', size: 'sm' })}>Toutes les boutiques</Link>
          {tenants.filter((tenant) => tenant.id !== context.tenant.id).slice(0, 12).map((tenant) => (
            <Link key={tenant.id} href={href({ tenant: tenant.id })} aria-current={values.tenant === tenant.id ? 'true' : undefined}
              className={buttonClasses({ variant: values.tenant === tenant.id ? 'primary' : 'ghost', size: 'sm' })}>{tenant.name}</Link>
          ))}
        </nav>
      )}

      {failure ? (
        <Card className="p-4">
          {failure.notInstalled
            ? <InlineAlert tone="warning" title="Journal non installé">La migration 153 n’est pas encore appliquée sur la base de données. Le journal apparaîtra dès son application.</InlineAlert>
            : <ErrorState description="Le journal n’a pas pu être lu. Réessayez dans un instant." action={<Link href={href({ page: values.page })} className={buttonClasses({ variant: 'secondary' })}>Réessayer</Link>} />}
        </Card>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {kpiCard(`Événements · ${periodLabel.toLowerCase()}`, summary?.total ?? 0, 'info', IconHistory)}
            {kpiCard('Échecs ou à vérifier', summary?.failures ?? 0, 'danger', IconAlertTriangle, 'failure')}
            {kpiCard('Critiques', summary?.critical ?? 0, 'urgent', IconUrgent, 'critical')}
            {kpiCard('Auteurs', summary?.actors ?? 0, 'neutral', IconUsers)}
          </div>
          {summary?.capped && <p className="mb-2 text-xs text-a-text-3">Plus de 100 000 événements sur la période : les compteurs sont plafonnés.</p>}

          <Card as="section" className="overflow-hidden">
            <h2 className="sr-only">Événements</h2>
            <Suspense fallback={<div className="h-14 border-b border-a-border" />}>
              <FilterBar
                search={{ label: 'Rechercher dans le journal', placeholder: 'Référence (#AB12CD34, AC-0012), ID d’événement, auteur…' }}
                filters={[
                  { type: 'select', key: 'period', label: 'Période', allLabel: '7 derniers jours', options: PERIOD_OPTIONS.filter((option) => option.value !== '7d').map((option) => ({ value: option.value, label: option.label })) },
                  { type: 'date-range', label: 'Dates (remplacent la période)', fromKey: 'from', toKey: 'to' },
                  { type: 'select', key: 'module', label: 'Module', allLabel: 'Tous les modules', options: tabModules.map((module) => ({ value: module, label: moduleLabel(module) })) },
                  { type: 'select', key: 'event', label: 'Événement', allLabel: 'Tous les événements', options: auditEventOptions(tabModules) },
                  { type: 'select', key: 'actor', label: 'Auteur', allLabel: 'Tous les auteurs', options: actors.map((actor) => ({ value: actor.id, label: actor.label })) },
                  { type: 'select', key: 'outcome', label: 'Résultat', allLabel: 'Tous les résultats', options: OUTCOME_OPTIONS.map((option) => ({ value: option.value, label: option.label })) },
                ]}
                activeChips={chips}
                resetHref={resetHref}
                sort={{ value: values.sort, options: [{ value: 'newest', label: 'Plus récents' }, { value: 'oldest', label: 'Plus anciens' }] }}
                resultLabel={total.capped ? `plus de ${formatNumber(total.total)} événements` : pluralize(total.total, 'événement')}
              />
            </Suspense>
            {offset > ACTIVITY_MAX_OFFSET ? (
              <EmptyState variant="filtered" title="Page trop éloignée." description="Réduisez la période ou ajoutez un filtre pour consulter des événements plus anciens."
                action={<Link href={href({ page: 1 })} className={buttonClasses({ variant: 'secondary' })}>Revenir à la première page</Link>} />
            ) : (
              <DataTable<AuditEventView>
                caption={`Journal d’activité, ${values.sort === 'oldest' ? 'plus anciens' : 'plus récents'} d’abord`}
                columns={columns}
                rowKey={(event) => event.id}
                rows={events}
                rowTone={(event) => (event.outcome === 'failure' ? 'danger' : event.outcome === 'unknown' || event.severity === 'critical' ? 'warning' : undefined)}
                mobileCard={(event) => {
                  const meta = statusMeta(AUDIT_OUTCOME_META, event.outcome);
                  return (
                    <Link href={href({ detail: event.id, page: values.page })} scroll={false} className="block p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 font-semibold">{event.label}</p>
                        <Badge tone={meta.tone} dot>{meta.label}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-a-text-2">{event.resourceLabel ?? event.moduleLabel}</p>
                      <AuditChanges changes={event.changes.slice(0, 2)} compact className="mt-0.5" />
                      <p className="mt-1 text-xs text-a-text-3">{event.actorLabel ?? AUDIT_ACTOR_LABELS[event.actorType]} · {formatRelative(event.occurredAt, now)}</p>
                    </Link>
                  );
                }}
                empty={hasFilters
                  ? <EmptyState variant="filtered" title="Aucun événement ne correspond à ces filtres." description="Modifiez ou réinitialisez les filtres, ou élargissez la période."
                      action={<Link href={resetHref} className={buttonClasses({ variant: 'secondary' })}>Réinitialiser les filtres</Link>} />
                  : <EmptyState title="Aucun événement sur la période." description="Les actions des administrateurs et des automatisations apparaîtront ici au fil de l’eau." />}
              />
            )}
            {total.total > 0 && offset <= ACTIVITY_MAX_OFFSET && (
              <Pagination window={window} noun="événements" hrefForPage={(page) => href({ page })} hrefForPageSize={(pageSize) => href({ pageSize })} pageSizes={ACTIVITY_LIST.pageSizes} />
            )}
          </Card>
          <p className="mt-2 text-xs text-a-text-3">
            Conservation : 24 mois pour l’activité, 90 jours pour les traces techniques. Les données personnelles et les secrets ne sont jamais enregistrés.
          </p>
        </>
      )}

      <EventDetailDrawer
        event={detail}
        notFound={Boolean(values.detail) && !detail && !failure}
        closeHref={closeHref}
        relatedHref={detail?.correlationId ? ACTIVITY_LIST.href(PATH, { ...ACTIVITY_LIST.parse({}), tab: values.tab, tenant: values.tenant, period: '730d' }, { corr: detail.correlationId }) : null}
        tenantName={scope.canSeePlatform && detail ? tenantName(detail.tenantId) : undefined}
      />
    </div>
  );
}
