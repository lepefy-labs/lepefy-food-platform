import { defineListParams, type ListParamValues } from '@/lib/admin/listParams';
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, SUPPORT_STATUSES } from './domain';

/**
 * URL state of the platform list « Assistance tenants ». The views are the
 * KPI cards; `attention` (default) sorts by need of intervention.
 */
export const SUPPORT_VIEWS = ['open', 'awaiting', 'new', 'urgent', 'stale', 'waiting_tenant', 'resolved', 'all'] as const;
export type SupportView = (typeof SUPPORT_VIEWS)[number];

export const SUPPORT_SORTS = ['attention', 'activity', 'newest', 'oldest'] as const;

export const SUPPORT_LIST = defineListParams({
  q: { type: 'search', maxLength: 80 },
  view: { type: 'enum', values: SUPPORT_VIEWS, default: 'open' },
  tenant: { type: 'uuid' },
  status: { type: 'enum', values: SUPPORT_STATUSES },
  category: { type: 'enum', values: SUPPORT_CATEGORIES },
  priority: { type: 'enum', values: SUPPORT_PRIORITIES },
  assignee: { type: 'string', maxLength: 40 },
  from: { type: 'date' },
  to: { type: 'date' },
  sort: { type: 'enum', values: SUPPORT_SORTS, default: 'attention' },
}, { pageSizes: [25, 50, 100], defaultPageSize: 25 });

export type SupportListParams = ListParamValues<typeof SUPPORT_LIST.spec>;

export const SUPPORT_VIEW_LABELS: Record<SupportView, string> = {
  open: 'Ouvertes',
  awaiting: 'À répondre',
  new: 'Nouvelles',
  urgent: 'Urgentes',
  stale: 'Sans réponse > 24 h',
  waiting_tenant: 'En attente boutique',
  resolved: 'Résolues (30 j)',
  all: 'Toutes',
};

export const SUPPORT_SORT_LABELS: Record<(typeof SUPPORT_SORTS)[number], string> = {
  attention: 'Besoin d’intervention',
  activity: 'Dernière activité',
  newest: 'Plus récentes',
  oldest: 'Plus anciennes',
};
