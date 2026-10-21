import Link from 'next/link';
import { Suspense } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { CATALOGUE_HIGHLIGHT_OPTIONS, CATALOGUE_ISSUE_OPTIONS, CATALOGUE_VIEW_OPTIONS, catalogueQueryString, parseCatalogueState, type CatalogueListState } from '@/lib/catalog/catalogueFilters';
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
import CatalogueFacets, { CATALOGUE_FACETS_ID, type FacetLink } from './CatalogueFacets';
import FacetsToggle from '../../_components/data/FacetsToggle';
import CatalogueTable from './CatalogueTable';
import { FULFILLMENT_POLICIES } from '@/lib/fulfillment/fulfillmentPolicy';
import { FULFILLMENT_POLICY_ADMIN_LABELS } from '@/lib/storefrontCopy/fulfillmentCopy';

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

/**
 * List state (q, view, highlight, issue, category, reception, sort, page) lives in the URL;
 * the server queries the whole catalogue. The sub-pages (campagnes, catégories, règles de
 * quantité) are reached from the sidebar entry « Produits ».
 */
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
  const categoryCounts = list?.categoryCounts ?? null;
  const total = list?.total ?? 0;
  const window = pageWindow(total, list?.page ?? state.page, CATALOGUE_PAGE_SIZE);
  const categoryList = (categories ?? []) as { id: string; name: string; slug: string; catalog_scope: string | null }[];
  const categoryName = categoryList.find((category) => category.slug === state.category)?.name;
  const highlightLabel = CATALOGUE_HIGHLIGHT_OPTIONS.find((option) => option.key === state.highlight)?.label;
  const issueLabel = CATALOGUE_ISSUE_OPTIONS.find((option) => option.key === state.issue)?.label;
  const hasFilters = Boolean(state.q || state.status !== 'all' || state.highlight || state.issue || state.category || state.reception);
  const resetHref = href({ q: '', status: 'all', highlight: '', issue: '', category: '', reception: '' });
  const chips: ActiveFilterChip[] = [
    ...(state.category ? [{ key: 'category', label: `Catégorie : ${categoryName ?? state.category}`, href: href({ category: '' }) }] : []),
    ...(highlightLabel ? [{ key: 'highlight', label: highlightLabel, href: href({ highlight: '' }) }] : []),
    ...(issueLabel ? [{ key: 'issue', label: `À compléter : ${issueLabel}`, href: href({ issue: '' }) }] : []),
    ...(state.reception ? [{ key: 'reception', label: `Réception : ${FULFILLMENT_POLICY_ADMIN_LABELS[state.reception]}`, href: href({ reception: '' }) }] : []),
  ];
  const warn = (key: string) => key === 'out' || key === 'low' || key === 'ai';
  const withCount = (label: string, count: number | null | undefined) => (count == null ? label : `${label} (${formatNumber(count)})`);
  const categoryCount = (id: string) => (categoryCounts ? categoryCounts[id] ?? 0 : null);

  // Side column (xl and up): every link keeps the other filters.
  const viewLinks: FacetLink[] = CATALOGUE_VIEW_OPTIONS.map((option) => ({
    key: option.key, label: option.label, href: href({ status: option.key }), active: state.status === option.key, count: counts[option.key], warn: warn(option.key), isDefault: option.key === 'all',
  }));
  const highlightLinks: FacetLink[] = [
    { key: 'all', label: 'Tous', href: href({ highlight: '' }), active: !state.highlight, isDefault: true },
    ...CATALOGUE_HIGHLIGHT_OPTIONS.map((option) => ({
      key: option.key, label: option.label, href: href({ highlight: option.key }), active: state.highlight === option.key, count: counts[option.key],
    })),
  ];
  const categoryLinks: FacetLink[] = [
    { key: 'all', label: 'Toutes', href: href({ category: '' }), active: !state.category, isDefault: true, count: categoryCounts ? Object.values(categoryCounts).reduce((sum, count) => sum + count, 0) : null },
    ...categoryList.map((category) => ({
      key: category.id, label: category.name, href: href({ category: category.slug }), active: state.category === category.slug,
      count: categoryCount(category.id),
      // The Goodies tag is left out when the name already says it.
      hint: category.catalog_scope === 'gadgets' && !/goodies/i.test(category.name) ? 'Goodies' : undefined,
    })),
  ];
  // « À compléter » appears when something is missing in the current selection, or while one of its filters is on.
  const showIssues = Boolean(state.issue) || CATALOGUE_ISSUE_OPTIONS.some((option) => (counts[option.key] ?? 0) > 0);

  return (
    <div className="admin-facets-scope mx-auto w-full max-w-7xl">
      <AdminPageHeader
        title="Catalogue"
        meta={list?.catalogueTotal != null ? pluralize(list.catalogueTotal, 'produit') : undefined}
        description="Gérez rapidement disponibilité, stock et contenu."
        actions={canManage ? <ButtonLink href="/admin/catalogue/nouveau" variant="primary"><IconPlus size={17} aria-hidden="true" /> Nouveau produit</ButtonLink> : undefined}
      />
      <div className="admin-facets-layout">
        <CatalogueFacets views={viewLinks} highlights={highlightLinks} categories={categoryLinks} />
        <Card as="section" className="min-w-0 overflow-hidden">
          <h2 className="sr-only">Liste des produits</h2>
          <Suspense fallback={<div className="h-14 border-b border-a-border" />}>
            <FilterBar
              viewsLabel="Filtrer par statut"
              viewsClassName="admin-facets-views"
              leading={<FacetsToggle mode="show" controls={CATALOGUE_FACETS_ID} />}
              views={CATALOGUE_VIEW_OPTIONS.map((option) => ({
                key: option.key, label: option.label, active: state.status === option.key, href: href({ status: option.key }),
                count: option.key === 'all' ? undefined : counts[option.key] ?? undefined, countTone: warn(option.key) ? 'warning' : 'neutral',
              }))}
              search={{ label: 'Rechercher un produit', placeholder: 'Nom, slug ou code-barres' }}
              filters={[
                { type: 'select', key: 'category', label: 'Catégorie', allLabel: 'Toutes les catégories', options: categoryList.map((category) => ({ value: category.slug, label: withCount(`${category.name} — ${category.catalog_scope === 'gadgets' ? 'Goodies' : 'Catalogue'}`, categoryCount(category.id)) })) },
                { type: 'select', key: 'highlight', label: 'Mise en avant', allLabel: 'Tous les produits', options: CATALOGUE_HIGHLIGHT_OPTIONS.map((option) => ({ value: option.key, label: withCount(option.label, counts[option.key]) })) },
                { type: 'select', key: 'reception', label: 'Mode de réception', allLabel: 'Tous les modes de réception', options: FULFILLMENT_POLICIES.map((policy) => ({ value: policy, label: FULFILLMENT_POLICY_ADMIN_LABELS[policy] })) },
              ]}
              activeChips={chips}
              resetHref={resetHref}
              sort={{ value: state.sort, options: SORT_OPTIONS }}
              resultLabel={pluralize(total, 'produit')}
            />
          </Suspense>
          {showIssues && (
            <nav aria-label="Données à compléter" className="flex flex-wrap items-center gap-1.5 border-b border-a-border px-3 py-2 text-xs text-a-text-2">
              <span className="mr-0.5 font-medium">À compléter</span>
              {CATALOGUE_ISSUE_OPTIONS.map((option) => {
                const count = counts[option.key] ?? null;
                const active = state.issue === option.key;
                return (
                  <Link key={option.key} href={href({ issue: active ? '' : option.key })} scroll={false} aria-current={active ? 'true' : undefined}
                    className={cn('inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium hover:underline',
                      count ? TONE_BADGE_CLASS.warning : 'border-a-border bg-a-surface text-a-text-3', active && 'ring-2 ring-a-brand')}>
                    {option.label}{count !== null && <b className="font-semibold tabular-nums">{formatNumber(count)}</b>}
                  </Link>
                );
              })}
            </nav>
          )}
          {!list
            ? <ErrorState title="Impossible de charger le catalogue." action={<ButtonLink href={href({ page: state.page })}>Réessayer</ButtonLink>} />
            : <CatalogueTable products={list.products} tenantCurrency={tenant.currency} canManage={canManage} pickupDisabled={!tenant.click_collect_enabled} listQuery={catalogueQueryString(state)} hasFilters={hasFilters} resetHref={resetHref} categories={categoryList} />}
          {list && total > 0 && <Pagination window={window} noun="produits" hrefForPage={(page) => href({ page })} />}
        </Card>
      </div>
    </div>
  );
}
