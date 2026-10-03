// Admin → Catalogue list: status filters, URL state and completeness badges.
// Pure (the query helper only chains a PostgREST builder it receives).

export type CatalogueStatus =
  | 'all' | 'active' | 'inactive' | 'out' | 'low' | 'ai'
  | 'no_weight' | 'no_image' | 'no_category';

/** Stock from 1 to LOW_STOCK_MAX is "low" (same threshold as the amber stock field). */
export const LOW_STOCK_MAX = 9;

export const CATALOGUE_STATUS_OPTIONS: ReadonlyArray<{ key: CatalogueStatus; label: string; group: 'state' | 'quality' }> = [
  { key: 'all', label: 'Tous', group: 'state' },
  { key: 'active', label: 'Actifs', group: 'state' },
  { key: 'inactive', label: 'Inactifs', group: 'state' },
  { key: 'out', label: 'Rupture', group: 'state' },
  { key: 'low', label: 'Stock bas', group: 'state' },
  { key: 'ai', label: 'IA à revoir', group: 'state' },
  { key: 'no_weight', label: 'Sans poids', group: 'quality' },
  { key: 'no_image', label: 'Sans photo', group: 'quality' },
  { key: 'no_category', label: 'Sans catégorie', group: 'quality' },
];

const STATUS_KEYS = new Set<string>(CATALOGUE_STATUS_OPTIONS.map((option) => option.key));

export const CATALOGUE_SORTS = ['position_asc', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'stock_asc', 'stock_desc'] as const;
export type CatalogueSort = typeof CATALOGUE_SORTS[number];

export interface CatalogueListState {
  q: string;
  status: CatalogueStatus;
  category: string;
  sort: CatalogueSort;
  page: number;
}

export function parseCatalogueState(params: { get(name: string): string | null }): CatalogueListState {
  const status = params.get('status') ?? 'all';
  const sort = params.get('sort') ?? 'position_asc';
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  return {
    q: (params.get('q') ?? '').slice(0, 80),
    status: STATUS_KEYS.has(status) ? status as CatalogueStatus : 'all',
    category: (params.get('category') ?? '').slice(0, 120),
    sort: (CATALOGUE_SORTS as readonly string[]).includes(sort) ? sort as CatalogueSort : 'position_asc',
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1,
  };
}

/** Defaults (all, position, page 1, no search/category) are omitted. */
export function catalogueQueryString(state: CatalogueListState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.status !== 'all') params.set('status', state.status);
  if (state.category) params.set('category', state.category);
  if (state.sort !== 'position_asc') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  return params.toString();
}

/** Applies one status filter to a products query (shared by the list and the counters). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyCatalogueStatus<Q extends Record<string, any>>(query: Q, status: CatalogueStatus): Q {
  switch (status) {
    case 'active': return query.eq('active', true);
    case 'inactive': return query.eq('active', false);
    case 'out': return query.lte('stock', 0);
    case 'low': return query.gte('stock', 1).lte('stock', LOW_STOCK_MAX);
    case 'ai': return query.eq('description_source', 'ai');
    case 'no_weight': return query.or('weight_grams.is.null,weight_grams.lte.0');
    case 'no_image': return query.is('image_url', null);
    case 'no_category': return query.is('category_id', null);
    default: return query;
  }
}

export type StockTone = 'out' | 'low' | 'ok';
export function stockTone(stock: number): StockTone {
  return stock <= 0 ? 'out' : stock <= LOW_STOCK_MAX ? 'low' : 'ok';
}

/** Missing data that breaks shipping, cartons or the storefront card (never shown when complete). */
export function completenessIssues(product: { weight_grams: number | null; image_url: string | null; category_id: string | null }): string[] {
  const issues: string[] = [];
  if (!product.weight_grams || product.weight_grams <= 0) issues.push('Sans poids');
  if (!product.image_url) issues.push('Sans photo');
  if (!product.category_id) issues.push('Sans catégorie');
  return issues;
}
