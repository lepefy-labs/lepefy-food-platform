import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { listGrowthProspects, touchCounts } from '@/lib/growth/server/repository';
import { STAGE_LABEL } from '@/lib/growth/contactPolicy';
import { WORKLIST_VIEWS, WORKLIST_VIEW_LABEL, followUpDue, inView, parseView, sortWorklist, viewCounts } from '@/lib/growth/worklist';
import type { GrowthProspectRow, GrowthStatus } from '@/lib/growth/types';
import { formatDate } from '@/lib/admin/format';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import AdminTabs from '../../../_components/ui/Tabs';
import Badge from '../../../_components/ui/Badge';
import InlineAlert from '../../../_components/ui/InlineAlert';
import { Panel } from '../../../_components/ui/Panel';
import { EmptyState } from '../../../_components/ui/States';
import PlatformSectionTabs from '../../../_components/PlatformSectionTabs';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<Exclude<GrowthStatus, 'respinta'>, { label: string; tone: 'success' | 'info' | 'neutral' }> = {
  pronta: { label: 'Prête', tone: 'success' },
  da_coltivare: { label: 'À cultiver', tone: 'info' },
  non_qualificata: { label: 'Non qualifiée', tone: 'neutral' },
};

const ENTRY_LABEL: Record<string, string> = {
  visit: 'Visite', written_channel: 'Canal écrit', introduction: 'Présentation', event: 'Événement', inbound: 'Demande entrante', none: 'Aucune',
};

export default async function ProspectionPage({ searchParams }: { searchParams: { vue?: string } }) {
  if (await requirePlatformOwner()) redirect('/admin');
  const view = parseView(searchParams.vue);
  const header = (
    <AdminPageHeader
      title="Prospection"
      description="Commerces repérés et vérifiés par la recherche Lepefy Growth : qui contacter, avec quel message, et la trace de chaque échange."
      breadcrumb={[{ label: 'Console Lepefy', href: '/admin/platform' }, { label: 'Prospection' }]}
      tabs={<PlatformSectionTabs groupId="development" />}
    />
  );

  let rows: GrowthProspectRow[];
  let counts: Record<string, number>;
  try {
    [rows, counts] = await Promise.all([listGrowthProspects(), touchCounts()]);
  } catch {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <InlineAlert tone="warning" title="Prospection indisponible">
          Les tables de la migration 185 ne sont pas lisibles. Appliquez la migration puis importez les fiches avec <code>node growth/cli.mjs push</code> (docs/GROWTH_PROSPECTING.md).
        </InlineAlert>
      </div>
    );
  }

  const now = new Date();
  const perView = viewCounts(rows, now);
  const shown = sortWorklist(rows.filter((r) => inView(r, view, now)), now);

  return (
    <div className="flex flex-col gap-6">
      {header}
      <AdminTabs
        label="Vues"
        tabs={WORKLIST_VIEWS.map((v) => ({
          href: v === 'aujourdhui' ? '/admin/platform/prospection' : `/admin/platform/prospection?vue=${v}`,
          label: WORKLIST_VIEW_LABEL[v],
          active: v === view,
          badge: <span className="tabular-nums text-a-text-3">{perView[v]}</span>,
        }))}
      />
      {!rows.length ? (
        <EmptyState title="Aucune fiche importée" description="Lancez un tour de recherche, puis importez l’archive avec node growth/cli.mjs push." />
      ) : !shown.length ? (
        <EmptyState title="Rien dans cette vue" description={view === 'aujourdhui' ? 'Aucun commerce prêt à contacter ni relance due aujourd’hui.' : 'Aucune fiche ne correspond.'} />
      ) : (
        <Panel title={WORKLIST_VIEW_LABEL[view]} description={view === 'aujourdhui' ? 'Commerces prêts jamais contactés et relances dues, par priorité.' : undefined} flush>
          <ul className="divide-y divide-a-border">
            {shown.map((row) => {
              const status = row.status === 'respinta' ? null : STATUS_BADGE[row.status];
              const due = followUpDue(row, now);
              return (
                <li key={row.id}>
                  <Link href={`/admin/platform/prospection/${row.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-a-focus sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-a-text">{row.name}</p>
                      <p className="text-sm text-a-text-2">{row.city} · {row.country} · fit {row.fit_score}/100 · entrée : {ENTRY_LABEL[row.entry_kind] ?? row.entry_kind}{row.entry_verified ? '' : ' (non vérifiée)'}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-a-text-3">{row.dossier?.verifiedFact?.text}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                      {row.priority && <Badge tone={row.priority === 'A' ? 'urgent' : 'neutral'}>Priorité {row.priority}</Badge>}
                      {status && <Badge tone={status.tone}>{status.label}</Badge>}
                      {row.separate_segment && <Badge tone="neutral">Autre segment</Badge>}
                      <Badge tone={row.sales_stage === 'perso' ? 'danger' : row.sales_stage === 'cliente' ? 'success' : 'info'}>{STAGE_LABEL[row.sales_stage]}</Badge>
                      {row.do_not_contact && <Badge tone="danger">Ne plus contacter</Badge>}
                      {due && <Badge tone="warning">Relance {formatDate(row.next_action_at, 'date', 'Europe/Paris')}</Badge>}
                      {(counts[row.id] ?? 0) > 0 && <span className="text-xs text-a-text-3">{counts[row.id]} échange{(counts[row.id] ?? 0) > 1 ? 's' : ''}</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
