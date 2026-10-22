import Link from 'next/link';
import { IconChevronRight, IconLifebuoy, IconPlus, IconSearch } from '@tabler/icons-react';
import { formatRelative, pluralize } from '@/lib/admin/format';
import { pageWindow } from '@/lib/admin/listParams';
import { SUPPORT_TENANT_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import { SUPPORT_CATEGORY_LABELS, supportReference } from '@/lib/support/domain';
import { requireSupportTenantPage } from '@/lib/support/server/access';
import { TENANT_PAGE_SIZE, tenantTicketPage } from '@/lib/support/server/tenantService';
import type { TenantTicketRow } from '@/lib/support/types';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import AdminTabs from '../../_components/ui/Tabs';
import Badge, { CountBadge } from '../../_components/ui/Badge';
import { ButtonLink } from '../../_components/ui/Button';
import { Input } from '../../_components/ui/Form';
import InlineAlert from '../../_components/ui/InlineAlert';
import { EmptyState, ErrorState } from '../../_components/ui/States';
import Pagination from '../../_components/data/Pagination';
import { SupportOpenButton } from '../../_components/support/SupportHeaderButton';
import SupportAutoOpen from './SupportAutoOpen';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PATH = '/admin/assistance';

function cleanSearch(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').replace(/[^\p{L}\p{N} '’#-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function hrefFor(view: 'open' | 'done', search: string, page = 1): string {
  const params = new URLSearchParams();
  if (view === 'done') params.set('vue', 'terminees');
  if (search) params.set('q', search);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `${PATH}?${qs}` : PATH;
}

/** Shop home of the Assistance: new replies first, then the open requests; finished ones in their tab. */
export default async function AssistancePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { tenant, access } = await requireSupportTenantPage();
  const view: 'open' | 'done' = searchParams.vue === 'terminees' ? 'done' : 'open';
  const search = cleanSearch(searchParams.q);
  const requestedPage = Number.parseInt(String(searchParams.page ?? '1'), 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 500) : 1;

  let result: { rows: TenantTicketRow[]; total: number } | null = null;
  let other = 0;
  try {
    const [current, counterpart] = await Promise.all([
      tenantTicketPage({ tenantId: tenant.id, adminId: access.userId, view, search, page }),
      tenantTicketPage({ tenantId: tenant.id, adminId: access.userId, view: view === 'open' ? 'done' : 'open', search: '', page: 1 }),
    ]);
    result = current;
    other = counterpart.total;
  } catch {
    result = null;
  }
  const openCount = view === 'open' && !search ? result?.total ?? 0 : view === 'open' ? null : other;
  const doneCount = view === 'done' && !search ? result?.total ?? 0 : view === 'done' ? null : other;
  const unread = (result?.rows ?? []).filter((row) => row.unread);
  const rest = (result?.rows ?? []).filter((row) => !row.unread);
  const window = pageWindow(result?.total ?? 0, page, TENANT_PAGE_SIZE);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <SupportAutoOpen />
      <AdminPageHeader
        title="Assistance"
        description="Signalez un problème, proposez une amélioration ou posez une question : l’équipe Lepefy vous répond ici."
        actions={<SupportOpenButton><IconPlus size={18} aria-hidden="true" />Nouvelle demande</SupportOpenButton>}
        tabs={(
          <AdminTabs label="Mes demandes" tabs={[
            { href: hrefFor('open', search), label: 'En cours', active: view === 'open', badge: openCount ? <CountBadge tone="neutral" count={openCount} /> : undefined },
            { href: hrefFor('done', search), label: 'Terminées', active: view === 'done', badge: doneCount ? <CountBadge tone="neutral" count={doneCount} /> : undefined },
          ]} />
        )}
      />

      {access.isPlatformOwner && (
        <InlineAlert tone="info" title="Aperçu de la vue boutique"
          action={<ButtonLink href="/admin/platform/assistance" size="sm" variant="secondary">Console Assistance tenants</ButtonLink>}>
          Vous voyez ce que voit l’équipe de {tenant.name}. Répondez depuis la console.
        </InlineAlert>
      )}

      <form action={PATH} method="get" role="search" className="relative">
        {view === 'done' && <input type="hidden" name="vue" value="terminees" />}
        <IconSearch size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
        <Input name="q" type="search" defaultValue={search} placeholder="Rechercher dans mes demandes (mot, n°)" aria-label="Rechercher dans mes demandes" className="pl-10" />
      </form>

      {!result ? (
        <ErrorState supportHint={false} title="Vos demandes ne peuvent pas être affichées pour le moment." description="Réessayez dans un instant. Vous pouvez quand même envoyer une nouvelle demande."
          action={<ButtonLink href={hrefFor(view, search, page)} variant="secondary">Réessayer</ButtonLink>} />
      ) : result.rows.length === 0 ? (
        search ? (
          <EmptyState variant="filtered" title="Aucune demande ne correspond à cette recherche." action={<ButtonLink href={hrefFor(view, '')} variant="secondary">Effacer la recherche</ButtonLink>} />
        ) : view === 'open' ? (
          <EmptyState title="Vous n’avez aucune demande en cours."
            description="Un souci, une idée, une question ? Écrivez-nous en une phrase, avec une capture si besoin."
            action={<SupportOpenButton><IconLifebuoy size={18} aria-hidden="true" />Faire une demande</SupportOpenButton>} />
        ) : (
          <EmptyState title="Aucune demande terminée pour l’instant." />
        )
      ) : (
        <div className="space-y-5">
          {unread.length > 0 && (
            <section aria-labelledby="support-unread" className="space-y-2">
              <h2 id="support-unread" className="text-sm font-semibold text-a-text">{pluralize(unread.length, 'Nouvelle réponse', 'Nouvelles réponses')}</h2>
              <ul className="space-y-2">{unread.map((row) => <TicketCard key={row.id} row={row} />)}</ul>
            </section>
          )}
          {rest.length > 0 && (
            <section aria-labelledby="support-list" className="space-y-2">
              {unread.length > 0 && <h2 id="support-list" className="text-sm font-semibold text-a-text">{view === 'open' ? 'En cours' : 'Terminées'}</h2>}
              <ul className="space-y-2" aria-labelledby={unread.length > 0 ? 'support-list' : undefined}>{rest.map((row) => <TicketCard key={row.id} row={row} />)}</ul>
            </section>
          )}
          {window.pages > 1 && <Pagination window={window} hrefForPage={(next) => hrefFor(view, search, next)} noun="demandes" />}
        </div>
      )}
    </div>
  );
}

function TicketCard({ row }: { row: TenantTicketRow }) {
  const status = statusMeta(SUPPORT_TENANT_STATUS_META, row.tenant_status);
  const author = row.last_message_author === 'lepefy' ? 'Équipe Lepefy' : 'Vous';
  return (
    <li>
      <Link href={`${PATH}/${row.id}`}
        className={[
          'group flex items-start gap-3 rounded-xl border bg-a-surface p-3.5 hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus sm:p-4',
          row.unread ? 'border-tone-info-border shadow-[inset_3px_0_0_var(--admin-tone-info-solid)]' : 'border-a-border',
        ].join(' ')}>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 text-base font-semibold text-a-text sm:text-sm">{row.title}</p>
            <Badge tone={status.tone} dot>{status.label}</Badge>
          </div>
          {row.last_message_excerpt && (
            <p className="line-clamp-2 text-sm text-a-text-2"><span className="font-semibold">{author} :</span> {row.last_message_excerpt}</p>
          )}
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-a-text-3">
            <span>{supportReference(row.number)}</span>
            {row.category !== 'unspecified' && <span>· {SUPPORT_CATEGORY_LABELS[row.category]}</span>}
            <span>· {formatRelative(row.last_activity_at)}</span>
            {row.merged_into_number && <span>· regroupée avec {supportReference(row.merged_into_number)}</span>}
            {row.unread && <span className="font-semibold text-tone-info-fg">· Nouvelle réponse</span>}
          </p>
        </div>
        <IconChevronRight size={18} aria-hidden="true" className="mt-1 shrink-0 text-a-text-3 group-hover:text-a-text" />
      </Link>
    </li>
  );
}
