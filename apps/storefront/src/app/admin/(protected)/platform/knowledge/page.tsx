import Link from 'next/link';
import { IconArchive, IconEdit, IconEye, IconFileText, IconPlus, IconSearch } from '@tabler/icons-react';
import { formatDate, formatNumber } from '@/lib/admin/format';
import { pageWindow } from '@/lib/admin/listParams';
import { HELP_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import { HELP_LEVEL_LABELS, HELP_MODULES, HELP_STATUSES, helpModuleLabel, type HelpStatus } from '@/lib/helpCenter/domain';
import { helpMetrics, listArticles, purgeOldMetrics, statusCounts, type HelpMetrics } from '@/lib/helpCenter/server/platformService';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import AdminStatCard from '../../../_components/ui/AdminStatCard';
import AdminTabs from '../../../_components/ui/Tabs';
import Badge from '../../../_components/ui/Badge';
import Button, { ButtonLink } from '../../../_components/ui/Button';
import { Input, Select } from '../../../_components/ui/Form';
import { EmptyState, ErrorState } from '../../../_components/ui/States';
import DataTable, { type DataColumn } from '../../../_components/data/DataTable';
import Pagination from '../../../_components/data/Pagination';
import ImportLibraryButton from './ImportLibraryButton';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PATH = '/admin/platform/knowledge';
const PAGE_SIZE = 25;
const TABS = [
  { key: 'articles', label: 'Articles' },
  { key: 'feedback', label: 'Retours' },
  { key: 'popular', label: 'Plus consultés' },
  { key: 'searches', label: 'Recherches sans résultat' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

type Row = Awaited<ReturnType<typeof listArticles>>['rows'][number];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

// Platform-owner access is enforced by app/admin/(protected)/platform/layout.tsx
// and by the console API routes (helpPlatformApi).
export default async function KnowledgePage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const tab: TabKey = (TABS.find((candidate) => candidate.key === first(searchParams.tab))?.key) ?? 'articles';
  const statusParam = first(searchParams.status);
  const status = (HELP_STATUSES as readonly string[]).includes(statusParam) ? statusParam as HelpStatus : null;
  const moduleParam = first(searchParams.module);
  const moduleKey = moduleParam in HELP_MODULES ? moduleParam : null;
  const search = first(searchParams.q).replace(/[^\p{L}\p{N} _-]/gu, ' ').trim().slice(0, 60);
  const page = Math.max(1, Number.parseInt(first(searchParams.page), 10) || 1);

  let list: Awaited<ReturnType<typeof listArticles>> | null = null;
  let counts: Record<HelpStatus, number> | null = null;
  let metrics: HelpMetrics | null = null;
  let failed = false;
  try {
    [list, counts, metrics] = await Promise.all([
      tab === 'articles' ? listArticles({ search, status, module: moduleKey, page, size: PAGE_SIZE }) : Promise.resolve(null),
      statusCounts(),
      helpMetrics(30),
    ]);
    void purgeOldMetrics();
  } catch (error) {
    failed = true;
    console.error('[platform/knowledge] load failed:', (error as { code?: string })?.code ?? error);
  }

  const href = (patch: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    const current: Record<string, string> = { tab: tab === 'articles' ? '' : tab, status: status ?? '', module: moduleKey ?? '', q: search };
    for (const [key, value] of Object.entries({ ...current, ...patch })) if (value !== '' && value !== null && value !== undefined) params.set(key, String(value));
    const query = params.toString();
    return query ? `${PATH}?${query}` : PATH;
  };

  const columns: DataColumn<Row>[] = [
    { key: 'title', header: 'Titre', className: 'min-w-[16rem]', cell: (row) => <Link href={`${PATH}/${row.id}`} className="font-semibold text-a-text hover:underline">{row.title}</Link> },
    { key: 'module', header: 'Module', hideBelow: 'md', cell: (row) => <span className="text-a-text-2">{helpModuleLabel(row.module)}</span> },
    { key: 'level', header: 'Niveau', hideBelow: 'lg', cell: (row) => <span className="text-a-text-2">{HELP_LEVEL_LABELS[row.min_level]}</span> },
    { key: 'locales', header: 'Langues', hideBelow: 'lg', cell: (row) => <span className="uppercase text-a-text-2">{row.locales.join(' · ') || '—'}</span> },
    { key: 'status', header: 'Statut', cell: (row) => { const meta = statusMeta(HELP_STATUS_META, row.status); return <Badge tone={meta.tone} dot>{meta.label}</Badge>; } },
    { key: 'version', header: 'Version', hideBelow: 'md', align: 'right', cell: (row) => <span className="tabular-nums text-a-text-2">v{row.version}</span> },
    { key: 'updated', header: 'Révisé le', hideBelow: 'xl', cell: (row) => <span className="whitespace-nowrap text-a-text-2">{formatDate(row.updated_at, 'date')}</span> },
  ];

  const noData = <span className="text-a-text-3">n.d.</span>;
  const windowed = list ? pageWindow(list.total, page, PAGE_SIZE) : null;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Base de connaissances"
        description="Guides du Centre d’aide, partagés par toutes les boutiques. Rien n’est publié sans votre relecture."
        breadcrumb={[{ label: 'Plateforme' }, { label: 'Base de connaissances' }]}
        actions={<div className="flex flex-wrap gap-2"><ImportLibraryButton /><ButtonLink href={`${PATH}/nouveau`} variant="primary"><IconPlus size={18} aria-hidden="true" />Nouvel article</ButtonLink></div>}
        tabs={<AdminTabs label="Sections" tabs={TABS.map((entry) => ({ href: href({ tab: entry.key === 'articles' ? '' : entry.key, page: null }), label: entry.label, active: entry.key === tab }))} />}
      />

      {failed && <ErrorState title="Base de connaissances indisponible" description="Vérifiez que la migration 174 est appliquée." supportHint={false} />}

      {counts && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminStatCard title="Brouillons" value={counts.draft} tone="neutral" icon={IconEdit} href={href({ tab: '', status: 'draft', page: null })} active={tab === 'articles' && status === 'draft'} />
          <AdminStatCard title="En relecture" value={counts.review} tone="warning" icon={IconEye} href={href({ tab: '', status: 'review', page: null })} active={tab === 'articles' && status === 'review'} />
          <AdminStatCard title="Publiés" value={counts.published} tone="success" icon={IconFileText} href={href({ tab: '', status: 'published', page: null })} active={tab === 'articles' && status === 'published'} />
          <AdminStatCard title="Archivés" value={counts.archived} tone="neutral" icon={IconArchive} href={href({ tab: '', status: 'archived', page: null })} active={tab === 'articles' && status === 'archived'} />
        </div>
      )}

      {tab === 'articles' && list && windowed && (
        <>
          <form method="get" action={PATH} role="search" className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <label htmlFor="kb-q" className="sr-only">Rechercher un article</label>
              <div className="relative">
                <IconSearch size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
                <Input id="kb-q" name="q" defaultValue={search} placeholder="Rechercher (slug, module)…" className="pl-9" />
              </div>
            </div>
            <div>
              <label htmlFor="kb-status" className="sr-only">Statut</label>
              <Select id="kb-status" name="status" defaultValue={status ?? ''}>
                <option value="">Tous les statuts</option>
                {HELP_STATUSES.map((value) => <option key={value} value={value}>{HELP_STATUS_META[value]!.label}</option>)}
              </Select>
            </div>
            <div>
              <label htmlFor="kb-module" className="sr-only">Module</label>
              <Select id="kb-module" name="module" defaultValue={moduleKey ?? ''}>
                <option value="">Tous les modules</option>
                {Object.entries(HELP_MODULES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </Select>
            </div>
            <Button type="submit" variant="secondary">Filtrer</Button>
            {(search || status || moduleKey) && <ButtonLink href={PATH} variant="ghost">Tout effacer</ButtonLink>}
          </form>
          <div className="overflow-hidden rounded-[10px] border border-a-border bg-a-surface">
            <DataTable<Row>
              caption="Articles du Centre d’aide"
              columns={columns}
              rowKey={(row) => row.id}
              rows={list.rows}
              rowTone={(row) => (row.status === 'review' ? 'warning' : undefined)}
              mobileCard={(row) => {
                const meta = statusMeta(HELP_STATUS_META, row.status);
                return (
                  <Link href={`${PATH}/${row.id}`} className="block space-y-1 p-3">
                    <p className="font-semibold text-a-text">{row.title}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-a-text-3"><Badge tone={meta.tone} dot>{meta.label}</Badge>{helpModuleLabel(row.module)} · v{row.version}</p>
                  </Link>
                );
              }}
              empty={<EmptyState variant={search || status || moduleKey ? 'filtered' : 'empty'} title={search || status || moduleKey ? 'Aucun article' : 'Aucun article pour le moment'} description="Créez le premier brouillon ou importez la bibliothèque initiale." />}
            />
            <Pagination window={windowed} hrefForPage={(target) => href({ page: target })} noun="articles" />
          </div>
        </>
      )}

      {tab === 'feedback' && metrics && (
        <MetricsTable
          caption="Retours des 30 derniers jours"
          empty="Aucun retour pour le moment."
          rows={metrics.popular.filter((row) => row.helpful + row.notHelpful + row.supportOpened > 0).sort((a, b) => b.notHelpful - a.notHelpful)}
          columns={[
            ['Guide', (row) => row.slug], ['Utile', (row) => formatNumber(row.helpful)], ['Pas utile', (row) => formatNumber(row.notHelpful)],
            ['Assistance ouverte après lecture', (row) => formatNumber(row.supportOpened)],
          ]}
        />
      )}
      {tab === 'popular' && metrics && (
        <MetricsTable
          caption="Guides les plus consultés (30 jours)"
          empty="Aucune consultation pour le moment."
          rows={metrics.popular}
          columns={[['Guide', (row) => row.slug], ['Vues', (row) => formatNumber(row.views)], ['Utile', (row) => formatNumber(row.helpful)], ['Pas utile', (row) => formatNumber(row.notHelpful)]]}
        />
      )}
      {tab === 'searches' && metrics && (
        <div className="space-y-3">
          <p className="text-sm text-a-text-2">
            {metrics.searches.total > 0
              ? <>Recherches (30 jours) : <b className="text-a-text">{formatNumber(metrics.searches.total)}</b>, dont <b className="text-a-text">{formatNumber(metrics.searches.empty)}</b> sans résultat.</>
              : <>Recherches (30 jours) : {noData}</>}
          </p>
          <MetricsTable
            caption="Termes sans résultat (30 jours)"
            empty="Aucune recherche sans résultat."
            rows={metrics.emptySearches}
            columns={[['Terme', (row) => row.term], ['Occurrences', (row) => formatNumber(row.total)]]}
          />
          <p className="text-xs text-a-text-3">Termes normalisés : les adresses e-mail, identifiants et numéros ne sont jamais conservés. Conservation 180 jours.</p>
        </div>
      )}
    </div>
  );
}

function MetricsTable<T>({ caption, rows, columns, empty }: { caption: string; rows: T[]; columns: Array<[string, (row: T) => string]>; empty: string }) {
  if (rows.length === 0) return <EmptyState title={empty} description="Les chiffres apparaissent dès que les boutiques utilisent l’aide." />;
  return (
    <div className="overflow-x-auto rounded-[10px] border border-a-border bg-a-surface">
      <table className="w-full border-separate border-spacing-0 text-sm text-a-text">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map(([header], index) => <th key={header} scope="col" className={`border-b border-a-border bg-a-surface-2 px-3 py-2 text-xs font-semibold text-a-text-2 ${index === 0 ? 'text-left' : 'text-right'}`}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{columns.map(([header, cell], index) => <td key={header} className={`border-b border-a-border px-3 py-2.5 ${index === 0 ? 'text-left font-semibold' : 'text-right tabular-nums text-a-text-2'}`}>{cell(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
