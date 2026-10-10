import { defineListParams, type ListParamValues, type RawSearchParams } from '@/lib/admin/listParams';
import { AUDIT_MODULE_KEYS, type AuditCategory, type AuditOutcome, type AuditSeverity } from './eventCatalog';

/** URL state of /admin/activite, shared by the page, the JSON API and the CSV export. */
export const ACTIVITY_LIST = defineListParams({
  tab: { type: 'enum', values: ['activity', 'automation', 'security'], default: 'activity' },
  q: { type: 'string', maxLength: 100 },
  period: { type: 'enum', values: ['24h', '7d', '30d', '90d', '365d', '730d', 'custom'], default: '7d' },
  from: { type: 'date' },
  to: { type: 'date' },
  module: { type: 'enum', values: AUDIT_MODULE_KEYS },
  event: { type: 'string', maxLength: 80 },
  actor: { type: 'uuid' },
  outcome: { type: 'enum', values: ['success', 'failure', 'critical'] },
  sort: { type: 'enum', values: ['newest', 'oldest'], default: 'newest' },
  rt: { type: 'string', maxLength: 40 },
  rid: { type: 'string', maxLength: 120 },
  corr: { type: 'string', maxLength: 100 },
  /** Platform owner only: a tenant id or `all`. */
  tenant: { type: 'string', maxLength: 36 },
  /** Event shown in the detail drawer. */
  detail: { type: 'string', maxLength: 50 },
}, { pageSizes: [25, 50, 100], defaultPageSize: 25 });

export type ActivityListValues = ListParamValues<typeof ACTIVITY_LIST.spec>;

export const PERIOD_OPTIONS = [
  { value: '24h', label: '24 dernières heures' },
  { value: '7d', label: '7 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: '90d', label: '90 derniers jours' },
  { value: '365d', label: '12 derniers mois' },
  { value: '730d', label: '24 derniers mois' },
  { value: 'custom', label: 'Période personnalisée' },
] as const;

export const OUTCOME_OPTIONS = [
  { value: 'success', label: 'Réussi' },
  { value: 'failure', label: 'Échec ou à vérifier' },
  { value: 'critical', label: 'Critique' },
] as const;

/** Maximum page reachable by offset; beyond it the admin narrows the period. */
export const ACTIVITY_MAX_OFFSET = 5_000;
/** Rows of a CSV export (one request, Vercel 60 s budget). */
export const ACTIVITY_EXPORT_LIMIT = 5_000;

const PERIOD_MS: Record<string, number> = {
  '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, '90d': 90 * 86_400_000,
  '365d': 365 * 86_400_000, '730d': 730 * 86_400_000,
};

/** UTC instant of local midnight in Europe/Rome for a YYYY-MM-DD date. */
export function romeMidnight(date: string): string {
  const guess = new Date(`${date}T00:00:00Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', timeZoneName: 'shortOffset' })
    .formatToParts(guess).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+1';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offset);
  const minutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 60;
  return new Date(guess.getTime() - minutes * 60_000).toISOString();
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Search text kept for the feed (references, ids, names); quoting is done in SQL. */
export function cleanActivitySearch(value: string | undefined): string | undefined {
  const cleaned = (value ?? '').replace(/[^\p{L}\p{N}@._+\-#: ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return cleaned || undefined;
}

export interface ActivityCriteria {
  categories: AuditCategory[];
  modules?: string[];
  eventTypes?: string[];
  actorAdminId?: string;
  outcomes?: AuditOutcome[];
  severities?: AuditSeverity[];
  from?: string;
  to?: string;
  resourceType?: string;
  resourceId?: string;
  search?: string;
  correlationId?: string;
  ascending: boolean;
}

/** URL values → feed criteria. `now` is injected for tests. */
export function activityCriteria(values: ActivityListValues, now = new Date(), options: { ignoreOutcome?: boolean } = {}): ActivityCriteria {
  const criteria: ActivityCriteria = {
    categories: [values.tab as AuditCategory],
    ascending: values.sort === 'oldest',
  };
  if (values.period === 'custom' || values.from || values.to) {
    if (values.from) criteria.from = romeMidnight(values.from);
    if (values.to) criteria.to = romeMidnight(nextDay(values.to));
  } else {
    criteria.from = new Date(now.getTime() - (PERIOD_MS[values.period] ?? PERIOD_MS['7d']!)).toISOString();
  }
  if (values.module) criteria.modules = [values.module];
  if (values.event && /^[a-z][a-z0-9_.]{2,79}$/.test(values.event)) criteria.eventTypes = [values.event];
  if (values.actor) criteria.actorAdminId = values.actor;
  if (!options.ignoreOutcome) {
    if (values.outcome === 'success') criteria.outcomes = ['success'];
    if (values.outcome === 'failure') criteria.outcomes = ['failure', 'unknown'];
    if (values.outcome === 'critical') criteria.severities = ['critical'];
  }
  if (values.rt && /^[a-z][a-z0-9_]{1,40}$/.test(values.rt) && values.rid) {
    criteria.resourceType = values.rt;
    criteria.resourceId = values.rid.replace(/[^A-Za-z0-9:._-]/g, '');
  }
  const search = cleanActivitySearch(values.q);
  if (search) criteria.search = search;
  if (values.corr && /^[A-Za-z0-9:._-]{1,100}$/.test(values.corr)) criteria.correlationId = values.corr;
  return criteria;
}

export function parseActivityList(raw: RawSearchParams): ActivityListValues {
  return ACTIVITY_LIST.parse(raw);
}
