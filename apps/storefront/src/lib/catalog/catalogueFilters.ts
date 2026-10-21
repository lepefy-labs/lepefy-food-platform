// Admin → Catalogue list: status filters, URL state and completeness badges.
// Pure (the query helper only chains a PostgREST builder it receives).

import type { ProductFulfillmentPolicy } from '@lepefy/types';
import { isFulfillmentPolicy } from '../fulfillment/fulfillmentPolicy';

// Three combinable dimensions, one value each: view (`?status=`), highlight (`?highlight=`), issue (`?issue=`).
/** Quick view: state, stock or AI review. */
export type CatalogueView = 'all' | 'active' | 'inactive' | 'out' | 'low' | 'ai';
/** Mise en avant (migration 156). */
export type CatalogueHighlight = 'promo' | 'promo_scheduled' | 'novelty';
/** Missing data that breaks shipping, cartons or the storefront card. */
export type CatalogueIssue = 'no_weight' | 'no_image' | 'no_category';
export type CatalogueStatus = CatalogueView | CatalogueHighlight | CatalogueIssue;

/** Stock from 1 to LOW_STOCK_MAX is "low" (same threshold as the amber stock field). */
export const LOW_STOCK_MAX = 9;

export const CATALOGUE_STATUS_OPTIONS: ReadonlyArray<{ key: CatalogueStatus; label: string; group: 'state' | 'quality' | 'highlight' }> = [
  { key: 'all', label: 'Tous', group: 'state' },
  { key: 'active', label: 'Actifs', group: 'state' },
  { key: 'inactive', label: 'Inactifs', group: 'state' },
  { key: 'out', label: 'Rupture', group: 'state' },
  { key: 'low', label: 'Stock bas', group: 'state' },
  { key: 'ai', label: 'IA à revoir', group: 'state' },
  { key: 'no_weight', label: 'Sans poids', group: 'quality' },
  { key: 'no_image', label: 'Sans photo', group: 'quality' },
  { key: 'no_category', label: 'Sans catégorie', group: 'quality' },
  // Mise en avant (migration 156) : promotions et nouveautés.
  { key: 'promo', label: 'En promo', group: 'highlight' },
  { key: 'promo_scheduled', label: 'Promo programmée', group: 'highlight' },
  { key: 'novelty', label: 'Nouveautés', group: 'highlight' },
];

export const CATALOGUE_VIEW_OPTIONS = CATALOGUE_STATUS_OPTIONS.filter((option) => option.group === 'state') as ReadonlyArray<{ key: CatalogueView; label: string; group: 'state' }>;
export const CATALOGUE_HIGHLIGHT_OPTIONS = CATALOGUE_STATUS_OPTIONS.filter((option) => option.group === 'highlight') as ReadonlyArray<{ key: CatalogueHighlight; label: string; group: 'highlight' }>;
export const CATALOGUE_ISSUE_OPTIONS = CATALOGUE_STATUS_OPTIONS.filter((option) => option.group === 'quality') as ReadonlyArray<{ key: CatalogueIssue; label: string; group: 'quality' }>;

const keysOf = <K extends string>(options: ReadonlyArray<{ key: K }>) => {
  const keys = new Set<string>(options.map((option) => option.key));
  return (value: string | null): value is K => value !== null && keys.has(value);
};
const isView = keysOf(CATALOGUE_VIEW_OPTIONS);
const isHighlight = keysOf(CATALOGUE_HIGHLIGHT_OPTIONS);
const isIssue = keysOf(CATALOGUE_ISSUE_OPTIONS);

export const CATALOGUE_SORTS = ['position_asc', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'stock_asc', 'stock_desc'] as const;
export type CatalogueSort = typeof CATALOGUE_SORTS[number];

export interface CatalogueListState {
  q: string;
  status: CatalogueView;
  /** '' = no highlight filter. */
  highlight: CatalogueHighlight | '';
  /** '' = no completeness filter. */
  issue: CatalogueIssue | '';
  category: string;
  sort: CatalogueSort;
  page: number;
  /** Mode de réception (migration 155) ; '' = tous. URL `?reception=`. */
  reception: ProductFulfillmentPolicy | '';
}

export function parseCatalogueState(params: { get(name: string): string | null }): CatalogueListState {
  const status = params.get('status') ?? 'all';
  const issue = params.get('issue');
  const highlight = params.get('highlight');
  const sort = params.get('sort') ?? 'position_asc';
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  const reception = params.get('reception');
  return {
    q: (params.get('q') ?? '').slice(0, 80),
    status: isView(status) ? status : 'all',
    // Before the three dimensions were split, `?status=` carried highlights and issues too: old links keep working.
    highlight: isHighlight(highlight) ? highlight : isHighlight(status) ? status : '',
    issue: isIssue(issue) ? issue : isIssue(status) ? status : '',
    category: (params.get('category') ?? '').slice(0, 120),
    sort: (CATALOGUE_SORTS as readonly string[]).includes(sort) ? sort as CatalogueSort : 'position_asc',
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1,
    reception: isFulfillmentPolicy(reception) ? reception : '',
  };
}

/** Defaults (all, position, page 1, no search/highlight/issue/category/reception) are omitted. */
export function catalogueQueryString(state: CatalogueListState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.status !== 'all') params.set('status', state.status);
  if (state.highlight) params.set('highlight', state.highlight);
  if (state.issue) params.set('issue', state.issue);
  if (state.category) params.set('category', state.category);
  if (state.reception) params.set('reception', state.reception);
  if (state.sort !== 'position_asc') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  return params.toString();
}

/** Applies one status filter to a products query (shared by the list and the counters). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyCatalogueStatus<Q extends Record<string, any>>(query: Q, status: CatalogueStatus, now: Date = new Date()): Q {
  switch (status) {
    case 'active': return query.eq('active', true);
    case 'inactive': return query.eq('active', false);
    case 'out': return query.lte('stock', 0);
    case 'low': return query.gte('stock', 1).lte('stock', LOW_STOCK_MAX);
    case 'ai': return query.eq('description_source', 'ai');
    case 'no_weight': return query.or('weight_grams.is.null,weight_grams.lte.0');
    case 'no_image': return query.is('image_url', null);
    case 'no_category': return query.is('category_id', null);
    // Un prix barré présent = promotion en cours (manuelle ou programmée appliquée).
    case 'promo': return query.not('compare_at_price', 'is', null);
    case 'promo_scheduled': return query.not('promo_price', 'is', null).eq('promo_applied', false);
    case 'novelty': return query.gt('new_until', now.toISOString());
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
