import Link from 'next/link';
import { IconCircleCheck, IconClock, IconLifebuoy, IconMessageCircle, IconPaperclip, IconPlus, IconSparkles, IconUrgent } from '@tabler/icons-react';
import { formatRelative, pluralize } from '@/lib/admin/format';
import { SUPPORT_PRIORITY_META, SUPPORT_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import { SUPPORT_CATEGORY_LABELS, SUPPORT_CHANNEL_LABELS, supportReference } from '@/lib/support/domain';
import { SUPPORT_LIST, SUPPORT_SORT_LABELS, SUPPORT_SORTS, SUPPORT_VIEW_LABELS, type SupportView } from '@/lib/support/platformList';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { platformKpis, platformOwners, platformTicketList, supportTenants, type PlatformListRow, type SupportKpis } from '@/lib/support/server/platformService';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import AdminStatCard from '../../../_components/ui/AdminStatCard';
import Badge from '../../../_components/ui/Badge';
import { ButtonLink } from '../../../_components/ui/Button';
import { Card } from '../../../_components/ui/Panel';
import { EmptyState, ErrorState } from '../../../_components/ui/States';
import DataTable, { type DataColumn } from '../../../_components/data/DataTable';
import FilterBar from '../../../_components/data/FilterBar';
import Pagination from '../../../_components/data/Pagination';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PATH = '/admin/platform/assistance';

const KPI_CARDS: Array<{ view: keyof SupportKpis; tone: 'warning' | 'info' | 'urgent' | 'danger' | 'neutral' | 'success'; icon: typeof IconLifebuoy }> = [
  { view: 'awaiting', tone: 'warning', icon: IconMessageCircle },
  { view: 'new', tone: 'info', icon: IconSparkles },
  { view: 'urgent', tone: 'urgent', icon: IconUrgent },
  { view: 'stale', tone: 'danger', icon: IconClock },
  { view: 'waiting_tenant', tone: 'neutral', icon: IconLifebuoy },
  { view: 'resolved', tone: 'success', icon: IconCircleCheck },
];

// Platform-owner access is enforced by app/admin/(protected)/platform/layout.tsx
// and by the platform API routes (supportPlatformApi → requirePlatformOwner).
export default async function PlatformAssistancePage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const values = SUPPORT_LIST.parse(searchParams);
  const href = (patch: Parameters<typeof SUPPORT_LIST.href>[2]) => SUPPORT_LIST.href(PATH, values, patch);
  const access = await getCurrentAdminAccessContext(null);
  const adminId = access?.userId ?? '';

  let list: Awaited<ReturnType<typeof platformTicketList>> | null = null;
  let kpis: SupportKpis | null = null;
  let tenants: Awaited<ReturnType<typeof supportTenants>> = [];
  let owners: Awaited<ReturnType<typeof platformOwners>> = [];
  try {
    [list, kpis, tenants, owners] = await Promise.all([platformTicketList(values, adminId), platformKpis(), supportTenants(), platformOwners()]);
  } catch (error) {
    console.error('[platform/assistance] load failed:', (error as { code?: string })?.code ?? error);
  }
  const ownerName = new Map(owners.map((owner) => [owner.id, owner.label]));

  const columns: DataColumn<PlatformListRow>[] = [
    { key: 'number', header: 'N°', cell: (row) => <span className="font-semibold tabular-nums text-a-text">{row.number}</span> },
    { key: 'tenant', header: 'Boutique', cell: (row) => <span className="text-a-text-2">{row.tenant_name}</span> },
    { key: 'title', header: 'Demande', className: 'min-w-[16rem] max-w-[28rem]', cell: (row) => <TicketTitle row={row} /> },
    { key: 'status', header: 'Statut', cell: (row) => { const meta = statusMeta(SUPPORT_STATUS_META, row.status); return <Badge tone={meta.tone} dot>{meta.label}</Badge>; } },
    { key: 'priority', header: 'Priorité', hideBelow: 'lg', cell: (row) => { const meta = statusMeta(SUPPORT_PRIORITY_META, row.priority); return <Badge tone={meta.tone}>{meta.label}</Badge>; } },
    { key: 'activity', header: 'Activité', hideBelow: 'md', cell: (row) => <span className="whitespace-nowrap text-a-text-2">{formatRelative(row.last_activity_at)}</span> },
    { key: 'assignee', header: 'Assignée', hideBelow: 'xl', cell: (row) => <span className="text-a-text-2">{row.assignee_admin_id ? ownerName.get(row.assignee_admin_id) ?? '—' : '—'}</span> },
  ];

  const viewCount = (view: SupportView) => (kpis && view in kpis ? kpis[view as keyof SupportKpis] : undefined);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Assistance tenants"
        description="Demandes des boutiques : répondre, organiser, résoudre. Les plus urgentes d’abord."
        actions={<ButtonLink href={`${PATH}/nouvelle`} variant="primary"><IconPlus size={18} aria-hidden="true" />Saisir une demande</ButtonLink>}
      />

      {kpis && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {KPI_CARDS.map((card) => (
            <AdminStatCard key={card.view} title={SUPPORT_VIEW_LABELS[card.view]} value={kpis![card.view]} tone={card.tone} icon={card.icon}
              href={values.view === card.view ? href({ view: 'open' }) : href({ view: card.view })} active={values.view === card.view} />
          ))}
        </div>
      )}

      <Card>
        <FilterBar
          views={(['open', 'awaiting', 'new', 'waiting_tenant', 'all'] as SupportView[]).map((view) => ({
            key: view, label: SUPPORT_VIEW_LABELS[view], href: href({ view }), active: values.view === view, count: viewCount(view),
          }))}
          viewsLabel="Vue"
          search={{ placeholder: 'N°, titre, texte, boutique, contact…', label: 'Rechercher une demande' }}
          filters={[
            { type: 'select', key: 'tenant', label: 'Boutique', options: tenants.map((tenant) => ({ value: tenant.id, label: `${tenant.name}${tenant.isTest ? ' (test)' : ''}` })), allLabel: 'Toutes les boutiques' },
            { type: 'select', key: 'status', label: 'Statut', options: Object.entries(SUPPORT_STATUS_META).map(([value, meta]) => ({ value, label: meta.label })), allLabel: 'Tous les statuts' },
            { type: 'select', key: 'category', label: 'Catégorie', options: Object.entries(SUPPORT_CATEGORY_LABELS).map(([value, label]) => ({ value, label })), allLabel: 'Toutes' },
            { type: 'select', key: 'priority', label: 'Priorité', options: Object.entries(SUPPORT_PRIORITY_META).map(([value, meta]) => ({ value, label: meta.label })), allLabel: 'Toutes' },
            { type: 'select', key: 'assignee', label: 'Assignée', options: [{ value: 'me', label: 'Moi' }, { value: 'none', label: 'Personne' }, ...owners.map((owner) => ({ value: owner.id, label: owner.label }))], allLabel: 'Tout le monde' },
            { type: 'date-range', label: 'Créée', fromKey: 'from', toKey: 'to' },
          ]}
          sort={{ value: values.sort, options: SUPPORT_SORTS.map((value) => ({ value, label: SUPPORT_SORT_LABELS[value] })) }}
          resetHref={PATH}
          resultLabel={list ? pluralize(list.window.total, 'demande') : undefined}
        />
        {!list ? (
          <ErrorState title="Demandes indisponibles" description="Vérifiez que la migration 163 est appliquée, puis réessayez." action={<ButtonLink href={href({})} variant="secondary">Réessayer</ButtonLink>} />
        ) : (
          <>
            <DataTable caption="Demandes d’assistance" columns={columns} rows={list.rows} rowKey={(row) => row.id} density="compact"
              rowTone={(row) => (row.awaiting_lepefy && (row.priority === 'high' || row.priority === 'critical') ? 'urgent' : row.stale ? 'danger' : row.awaiting_lepefy ? 'warning' : undefined)}
              mobileCard={(row) => (
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <TicketTitle row={row} />
                    <Badge tone={statusMeta(SUPPORT_STATUS_META, row.status).tone} dot>{statusMeta(SUPPORT_STATUS_META, row.status).label}</Badge>
                  </div>
                  <p className="text-xs text-a-text-3">{supportReference(row.number)} · {row.tenant_name} · {formatRelative(row.last_activity_at)} · {statusMeta(SUPPORT_PRIORITY_META, row.priority).label}</p>
                </div>
              )}
              empty={<EmptyState variant={SUPPORT_LIST.activeCount(values) > 0 || values.q ? 'filtered' : 'empty'} title={values.view === 'awaiting' ? 'Aucune demande n’attend de réponse.' : 'Aucune demande pour ces critères.'} />} />
            <Pagination window={list.window} noun="demandes" hrefForPage={(page) => href({ page })} hrefForPageSize={(size) => href({ pageSize: size })} pageSizes={SUPPORT_LIST.pageSizes} />
          </>
        )}
      </Card>
    </div>
  );
}

function TicketTitle({ row }: { row: PlatformListRow }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <Link href={`${PATH}/${row.id}`} className="font-semibold text-a-text hover:text-a-brand-fg hover:underline">
        {row.unread && <span aria-label="Message non lu" className="mr-1.5 inline-block h-2 w-2 rounded-full bg-tone-info-solid align-middle" />}
        {row.title}
      </Link>
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-a-text-3">
        {row.category !== 'unspecified' && <span>{SUPPORT_CATEGORY_LABELS[row.category]}</span>}
        {typeof row.context?.page_label === 'string' && <span>· {row.context.page_label}</span>}
        {row.source_channel !== 'app' && <span>· via {SUPPORT_CHANNEL_LABELS[row.source_channel]}</span>}
        {row.declared_urgent && <span className="font-semibold text-tone-urgent-fg">· urgent déclaré</span>}
        {row.attachments > 0 && <span className="inline-flex items-center gap-0.5">· <IconPaperclip size={12} aria-hidden="true" />{row.attachments}</span>}
        {row.reopen_count > 0 && <span>· rouverte</span>}
        {!row.visible_to_tenant && <span>· non visible par la boutique</span>}
        {row.merged_into_ticket_id && <span>· fusionnée</span>}
      </p>
    </div>
  );
}
