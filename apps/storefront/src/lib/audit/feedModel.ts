import {
  AUDIT_MODULES, auditEventLabel, auditResourceHref,
  type AuditActorKind, type AuditCategory, type AuditOutcome, type AuditSeverity,
} from './eventCatalog';
import { sanitizeAuditJson, sanitizeChanges, maskText, type AuditChange, type SafeJson } from './sanitize';
import type { JournalScope } from './scope';

/**
 * Pure part of the journal feed (no server dependency, unit-tested): row and
 * view types, filters sent to the feed RPCs, row → view projection.
 */

/** Row of the `audit_feed` view (migration 153 §12). */
export interface AuditFeedRow {
  id: string;
  source: string;
  tenant_id: string | null;
  event_type: string;
  module: string;
  category: AuditCategory;
  severity: AuditSeverity;
  outcome: AuditOutcome;
  actor_type: AuditActorKind;
  actor_admin_id: string | null;
  actor_label: string | null;
  actor_ref: string | null;
  resource_type: string | null;
  resource_id: string | null;
  resource_label: string | null;
  changes: unknown;
  metadata: unknown;
  correlation_id: string | null;
  occurred_at: string;
  recorded_at: string;
}

/** What leaves the server: labelled, masked, links resolved. */
export interface AuditEventView {
  id: string;
  source: string;
  tenantId: string | null;
  eventType: string;
  label: string;
  module: string;
  moduleLabel: string;
  category: AuditCategory;
  severity: AuditSeverity;
  outcome: AuditOutcome;
  actorType: AuditActorKind;
  actorId: string | null;
  actorLabel: string | null;
  actorRef: string | null;
  resourceType: string | null;
  resourceId: string | null;
  resourceLabel: string | null;
  resourceHref: string | null;
  changes: AuditChange[];
  metadata: SafeJson;
  correlationId: string | null;
  occurredAt: string;
  recordedAt: string;
}

export interface FeedCriteria {
  categories?: AuditCategory[];
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
  id?: string;
  ascending?: boolean;
  cursor?: { at: string; id: string };
}

/** Tenant perimeter: always resolved on the server, never from the client alone. */
export type FeedTenantScope = { tenantIds: string[] } | { allTenants: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Filters for the feed RPCs. Module and category lists are intersected with
 * the admin's scope: the RPC returns nothing for an empty list (fail-closed).
 */
export function buildFeedFilters(scope: JournalScope, tenants: FeedTenantScope, criteria: FeedCriteria = {}): Record<string, unknown> {
  const modules = (criteria.modules?.length ? criteria.modules.filter((m) => (scope.modules as string[]).includes(m)) : scope.modules);
  const categories = criteria.categories?.length ? criteria.categories.filter((c) => scope.categories.includes(c)) : scope.categories;
  const filters: Record<string, unknown> = { modules, categories };
  if ('allTenants' in tenants) {
    if (!scope.canSeePlatform) return { modules: [] };
    filters.all_tenants = true;
    filters.include_platform = true;
  } else {
    filters.tenant_ids = tenants.tenantIds.filter((id) => UUID.test(id));
    // Platform-level rows (roles, tenant-less events) only in the platform view.
    filters.include_platform = false;
  }
  if (criteria.eventTypes?.length) filters.event_types = criteria.eventTypes;
  if (criteria.actorAdminId && UUID.test(criteria.actorAdminId)) filters.actor_admin_id = criteria.actorAdminId;
  if (criteria.outcomes?.length) filters.outcomes = criteria.outcomes;
  if (criteria.severities?.length) filters.severities = criteria.severities;
  if (criteria.from) filters.from = criteria.from;
  if (criteria.to) filters.to = criteria.to;
  if (criteria.resourceType) filters.resource_type = criteria.resourceType;
  if (criteria.resourceId) filters.resource_id = criteria.resourceId;
  if (criteria.search) filters.search = criteria.search;
  if (criteria.correlationId) filters.correlation_id = criteria.correlationId;
  if (criteria.id) filters.id = criteria.id;
  if (criteria.ascending) filters.ascending = true;
  if (criteria.cursor) { filters.cursor_at = criteria.cursor.at; filters.cursor_id = criteria.cursor.id; }
  return filters;
}

export function toEventView(row: AuditFeedRow): AuditEventView {
  const moduleDefinition = (AUDIT_MODULES as Record<string, { label: string }>)[row.module];
  return {
    id: row.id,
    source: row.source,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    label: auditEventLabel(row.event_type),
    module: row.module,
    moduleLabel: moduleDefinition?.label ?? row.module,
    category: row.category,
    severity: row.severity,
    outcome: row.outcome,
    actorType: row.actor_type,
    actorId: row.actor_admin_id,
    actorLabel: row.actor_label ? maskText(row.actor_label) : null,
    actorRef: row.actor_ref,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceLabel: row.resource_label ? maskText(row.resource_label) : null,
    resourceHref: auditResourceHref(row.resource_type, row.resource_id),
    changes: sanitizeChanges(row.changes),
    metadata: sanitizeAuditJson(row.metadata),
    correlationId: row.correlation_id,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  };
}
