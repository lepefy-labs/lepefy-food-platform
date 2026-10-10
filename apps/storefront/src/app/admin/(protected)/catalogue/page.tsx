import Link from 'next/link';
import { Suspense } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { CATALOGUE_STATUS_OPTIONS, catalogueQueryString, parseCatalogueState, type CatalogueListState } from '@/lib/catalog/catalogueFilters';
import { CATALOGUE_PAGE_SIZE, loadCatalogueList, type CatalogueListResult } from '@/lib/catalog/catalogueList';
import { pageWindow } from '@/lib/admin/listParams';
import { formatNumber, pluralize } from '@/lib/admin/format';
import { cn } from '@/lib/utils/cn';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { TONE_BADGE_CLASS } from '../../_components/ui/Badge';
import { ButtonLink } from '../../_components/ui/Button';
import { Card } from '../../_components/ui/Panel';
import { ErrorState } from '../../_components/ui/States';
import FilterBar, { type ActiveFilterChip } from '../../_components/data/FilterBar';
import Pagination from '../../_components/data/Pagination';
import CatalogueTable from './CatalogueTable';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const SORT_OPTIONS = [
  { value: 'position_asc', label: 'Ordre catalogue' },
  { value: 'name_asc', label: 'Nom A → Z' },
  { value: 'name_desc', label: 'Nom Z → A' },
  { value: 'price_asc', label: 'Prix croissant' },
  { value: 'price_desc', label: 'Prix décroissant' },
  { value: 'stock_asc', label: 'Stock croissant' },
  { value: 'stock_desc', label: 'Stock décroissant' },
];

/** List state (q, status, category, sort, page) lives in the URL; the server queries the whole catalogue. */
export default async function AdminCataloguePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();
  const state = parseCatalogueState({ get: (name) => { const value = searchParams[name]; return (Array.isArray(value) ? value[0] : value) ?? null; } });

  const [{ data: categories }, access, list] = await Promise.all([
    supabase.from('categories').select('id, name, slug, catalog_scope').eq('tenant_id', tenant.id).order('position'),
    getCurrentAdminAccessContext(tenant.id),
    loadCatalogueList(supabase, tenant.id, state).catch((error: unknown): CatalogueListResult | null => { console.error('[admin/catalogue] list unavailable', error); return null; }),
  ]);
  // UI hint only: the catalogue write routes re-check catalog.manage.
  const canManage = Boolean(access && canAdmin(access, 'catalog.manage'));
  const href = (patch: Partial<CatalogueListState>) => {
    const query = catalogueQueryString({ ...state, page: 1, ...patch });
    return query ? `/admin/catalogue?${query}` : '/admin/catalogue';
  };
  const counts = list?.counts ?? {};
  const total = list?.total ?? 0;
  const window = pageWindow(total, list?.page ?? state.page, CATALOGUE_PAGE_SIZE);
  const categoryList = (categories ?? []) as { id: string; name: string; slug: string; catalog_scope: string | null }[];
  const categoryName = categoryList.find((category) => category.slug === state.category)?.name;
  const hasFilters = Boolean(state.q || state.status !== 'all' || state.category);
  const resetHref = href({ q: '', status: 'all', category: '' });
  const chips: ActiveFilterChip[] = [
    ...(state.category ? [{ key: 'category', label: `Catégorie : ${categoryName ?? state.category}`, href: href({ category: '' }) }] : []),
    ...(CATALOGUE_STATUS_OPTIONS.find((option) => option.key === state.status && option.group === 'quality')
      ? [{ key: 'status', label: CATALOGUE_STATUS_OPTIONS.find((option) => option.key === state.status)!.label, href: href({ status: 'all' }) }]
      : []),
  ];
  const warn = (key: string) => key === 'out' || key === 'low' || key === 'ai';

  return (
    <div className="mx-auto w-full max-w-7xl">
      <AdminPageHeader
        title="Catalogue"
        meta={counts.all != null ? pluralize(counts.all, 'produit') : undefined}
        description="Gérez rapidement disponibilité, stock et contenu."
        actions={<>
          <ButtonLink href="/admin/catalogue/categories">Catégories</ButtonLink>
          <ButtonLink href="/admin/catalogue/quantity-groups">Règles de quantité</ButtonLink>
          {canManage && <ButtonLink href="/admin/catalogue/nouveau" variant="primary"><IconPlus size={17} aria-hidden="true" /> Nouveau produit</ButtonLink>}
        </>}
      />
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-a-text-3">
        <span className="mr-0.5">À compléter</span>
        {CATALOGUE_STATUS_OPTIONS.filter((option) => option.group === 'quality').map((option) => {
          const count = counts[option.key] ?? null;
          const active = state.status === option.key;
          return (
            <Link key={option.key} href={href({ status: active ? 'all' : option.key })} aria-current={active ? 'true' : undefined}
              className={cn('inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium hover:underline',
                count ? TONE_BADGE_CLASS.warning : 'border-a-border bg-a-surface text-a-text-3', active && 'ring-1 ring-a-brand')}>
              {option.label}{count !== null && <b className="font-semibold tabular-nums">{formatNumber(count)}</b>}
            </Link>
          );
        })}
      </div>
      <Card as="section" className="overflow-hidden">
        <h2 className="sr-only">Liste des produits</h2>
        <Suspense fallback={<div className="h-14 border-b border-a-border" />}>
          <FilterBar
            viewsLabel="Filtrer par statut"
            views={CATALOGUE_STATUS_OPTIONS.filter((option) => option.group === 'state').map((option) => ({
              key: option.key, label: option.label, active: state.status === option.key, href: href({ status: option.key }),
              count: option.key === 'all' ? undefined : counts[option.key] ?? undefined, countTone: warn(option.key) ? 'warning' : 'neutral',
            }))}
            search={{ label: 'Rechercher un produit', placeholder: 'Nom, slug ou code-barres' }}
            filters={[{ type: 'select', key: 'category', label: 'Catégorie', allLabel: 'Toutes les catégories', options: categoryList.map((category) => ({ value: category.slug, label: `${category.name} — ${category.catalog_scope === 'gadgets' ? 'Goodies' : 'Catalogue'}` })) }]}
            activeChips={chips}
            resetHref={resetHref}
            sort={{ value: state.sort, options: SORT_OPTIONS }}
            resultLabel={pluralize(total, 'produit')}
          />
        </Suspense>
        {!list
          ? <ErrorState title="Impossible de charger le catalogue." action={<ButtonLink href={href({ page: state.page })}>Réessayer</ButtonLink>} />
          : <CatalogueTable products={list.products} tenantCurrency={tenant.currency} canManage={canManage} listQuery={catalogueQueryString(state)} hasFilters={hasFilters} resetHref={resetHref} />}
        {list && total > 0 && <Pagination window={window} noun="produits" hrefForPage={(page) => href({ page })} />}
      </Card>
    </div>
  );
}
