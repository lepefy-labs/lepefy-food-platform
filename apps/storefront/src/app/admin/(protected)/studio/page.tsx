import Link from 'next/link';
import { IconSearch } from '@tabler/icons-react';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import AdminTabs from '../../_components/ui/Tabs';
import Badge from '../../_components/ui/Badge';
import { EmptyState, ErrorState } from '../../_components/ui/States';
import { buttonClasses } from '../../_components/ui/Button';
import { controlClasses } from '../../_components/ui/Form';
import { createServiceClient } from '@/lib/supabase/server';
import { requireStudioPage } from '@/lib/studio/server/access';
import { listStudioAssets, studioQuota } from '@/lib/studio/server/assets';
import { ensureActiveStyle } from '@/lib/studio/server/style';
import { STUDIO_LIBRARY_VIEWS, STUDIO_LIMITS, type StudioLibraryView } from '@/lib/studio/domain';
import { cleanText, isUuid, STUDIO_VIEW_LABELS } from '@/lib/studio/rules';
import { STUDIO_ASSET_STATUS_META } from '@/lib/admin/statusRegistry';
import { formatRelative } from '@/lib/admin/format';
import StudioCreatePanel from './StudioCreatePanel';
import StudioLibraryRefresh from './StudioLibraryRefresh';
import StudioStyleButton from './StudioStyleButton';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? undefined;

function libraryHref(view: StudioLibraryView, q?: string, page?: number) {
  const params = new URLSearchParams();
  if (view !== 'toutes') params.set('statut', view);
  if (q) params.set('q', q);
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/admin/studio${query ? `?${query}` : ''}#bibliotheque`;
}

/**
 * Studio images: create first, choose where to use the image only once it is
 * approved. Library = server list driven by the URL (`statut`, `q`, `page`).
 */
export default async function StudioPage({ searchParams = {} }: { searchParams?: SearchParams }) {
  const { tenant, access } = await requireStudioPage();
  const viewParam = first(searchParams.statut) ?? 'toutes';
  const view = (STUDIO_LIBRARY_VIEWS as readonly string[]).includes(viewParam) ? viewParam as StudioLibraryView : 'toutes';
  const q = cleanText(first(searchParams.q), 80) ?? undefined;
  const page = Math.max(1, Number(first(searchParams.page) ?? '1') || 1);

  // « Générer avec l’IA » of a product: `?pour=product:<uuid>`, re-read in the tenant.
  const pourRaw = first(searchParams.pour) ?? null;
  const db = createServiceClient();
  let pour: string | null = null;
  let pourLabel: string | null = null;
  if (pourRaw?.startsWith('product:') && isUuid(pourRaw.slice(8))) {
    const { data } = await db.from('products').select('id, name').eq('tenant_id', tenant.id).eq('id', pourRaw.slice(8)).maybeSingle();
    if (data) { pour = pourRaw; pourLabel = `produit « ${data.name} »`; }
  }

  let content;
  try {
    const [style, quota, list] = await Promise.all([
      ensureActiveStyle(db, tenant.id, access.userId),
      studioQuota(db, tenant.id),
      listStudioAssets(db, tenant.id, { view, q, page }),
    ]);
    const pages = Math.max(1, Math.ceil(list.total / STUDIO_LIMITS.pageSize));
    const tabs = (['a-valider', 'pretes', 'utilisees', 'en-cours', 'toutes', 'ecartees'] as StudioLibraryView[]).map((key) => ({
      href: libraryHref(key, q),
      label: STUDIO_VIEW_LABELS[key],
      active: key === view,
      badge: key === 'a-valider' && list.counts.review > 0 ? <Badge tone="warning">{list.counts.review}</Badge>
        : key === 'en-cours' && list.counts.processing > 0 ? <Badge tone="info">{list.counts.processing}</Badge> : undefined,
    }));
    content = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
        <StudioCreatePanel styleSummary={style.instructions.summary} styleVersion={style.version} remaining={quota.remaining} pour={pour} pourLabel={pourLabel} />

        <section id="bibliotheque" aria-labelledby="studio-library-title" className="min-w-0 scroll-mt-20 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="studio-library-title" className="text-base font-semibold text-a-text">Bibliothèque</h2>
            <form action="/admin/studio" className="flex w-full gap-2 sm:w-auto" role="search">
              {view !== 'toutes' && <input type="hidden" name="statut" value={view} />}
              <label htmlFor="studio-search" className="sr-only">Rechercher une image</label>
              <input id="studio-search" name="q" defaultValue={q} placeholder="Rechercher" className={`${controlClasses} w-full sm:w-56`} />
              <button type="submit" className={buttonClasses({ variant: 'secondary' })} aria-label="Rechercher"><IconSearch size={18} aria-hidden="true" /></button>
            </form>
          </div>
          <AdminTabs tabs={tabs} label="Filtrer la bibliothèque" />
          <StudioLibraryRefresh active={list.counts.processing > 0} />

          {list.items.length === 0 ? (
            <EmptyState
              variant={q || view !== 'toutes' ? 'filtered' : 'empty'}
              title={q || view !== 'toutes' ? 'Aucune image dans cette vue.' : 'Aucune image pour le moment.'}
              description={q || view !== 'toutes' ? 'Changez de vue ou de recherche.' : 'Créez votre première image à partir d’une photo ou d’une idée.'}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {list.items.map((item) => {
                const meta = item.status === 'approved' && item.activeUsages > 0
                  ? { label: `Utilisée · ${item.activeUsages}`, tone: 'success' as const }
                  : STUDIO_ASSET_STATUS_META[item.status] ?? { label: item.status, tone: 'neutral' as const };
                return (
                  <li key={item.id}>
                    <Link href={`/admin/studio/${item.id}`} className="group block rounded-[10px] border border-a-border bg-a-surface p-2 hover:border-a-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
                      <div className="relative aspect-square overflow-hidden rounded-md bg-a-surface-2">
                        {item.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-a-text-3">{item.status === 'processing' ? 'Création en cours…' : 'Pas d’aperçu'}</div>
                        )}
                        <span className="absolute left-1.5 top-1.5"><Badge tone={meta.tone} dot>{meta.label}</Badge></span>
                      </div>
                      <p className="mt-2 truncate text-sm font-semibold text-a-text">{item.title}</p>
                      <p className="text-xs text-a-text-3">{item.ambianceOnly ? 'Idée · ambiance' : 'Photo'} · {formatRelative(item.updatedAt)}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {pages > 1 && (
            <nav aria-label="Pages de la bibliothèque" className="flex items-center justify-between gap-2 text-sm">
              {page > 1 ? <Link className={buttonClasses({ variant: 'secondary', size: 'sm' })} href={libraryHref(view, q, page - 1)}>Précédente</Link> : <span />}
              <span className="text-a-text-3">Page {page} sur {pages} · {list.total} images</span>
              {page < pages ? <Link className={buttonClasses({ variant: 'secondary', size: 'sm' })} href={libraryHref(view, q, page + 1)}>Suivante</Link> : <span />}
            </nav>
          )}
          <p className="text-xs text-a-text-3">Les images jamais utilisées sont supprimées après 30 jours sans activité ; les images écartées après 7 jours.</p>
        </section>
      </div>
    );
  } catch (error) {
    const missing = (error as { code?: string })?.code;
    console.error('[studio] page load failed', tenant.id, missing ?? (error instanceof Error ? error.message.slice(0, 160) : 'unknown'));
    content = <ErrorState title="Impossible de charger le Studio." description={missing === '42P01' || missing === 'PGRST205' ? 'Le Studio images n’est pas encore installé (migration 183).' : 'Réessayez dans un instant.'} />;
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Studio images"
        description="Créez une image, vérifiez-la, puis choisissez où l’utiliser."
        actions={<StudioStyleButton />}
      />
      {content}
    </div>
  );
}
