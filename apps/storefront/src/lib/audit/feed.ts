import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { AUDIT_MODULES, type AuditModule } from './eventCatalog';
import { maskText } from './sanitize';
import { buildFeedFilters, toEventView, type AuditEventView, type AuditFeedRow, type FeedTenantScope } from './feedModel';
import type { JournalScope } from './scope';

export { buildFeedFilters, toEventView } from './feedModel';
export type { AuditEventView, AuditFeedRow, FeedCriteria, FeedTenantScope } from './feedModel';

export class AuditFeedUnavailable extends Error {
  constructor(public readonly notInstalled: boolean) { super(notInstalled ? 'audit_not_installed' : 'audit_unavailable'); }
}

function fail(error: { code?: string; message?: string }): never {
  const missing = error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01'
    || (/audit_feed/.test(error.message ?? '') && /does not exist|not find/.test(error.message ?? ''));
  console.error('[audit] feed query failed — code:', error.code ?? 'unknown');
  throw new AuditFeedUnavailable(missing);
}

export async function loadFeedPage(filters: Record<string, unknown>, limit: number, offset = 0): Promise<AuditEventView[]> {
  const { data, error } = await createServiceClient().rpc('audit_feed_page', { p_filters: filters, p_limit: limit, p_offset: offset });
  if (error) fail(error);
  const rows = (data ?? []) as AuditFeedRow[];
  // Actor labels of historical sources come from admin_users (display name, never the e-mail).
  const missing = Array.from(new Set(rows.filter((row) => !row.actor_label && row.actor_admin_id).map((row) => row.actor_admin_id!)));
  if (missing.length > 0) {
    const { data: admins } = await createServiceClient().from('admin_users').select('id, first_name, last_name, nickname').in('id', missing);
    const names = new Map(((admins ?? []) as { id: string; first_name: string | null; last_name: string | null; nickname: string | null }[])
      .map((admin) => [admin.id, [admin.first_name, admin.last_name].filter(Boolean).join(' ').trim() || admin.nickname || 'Administrateur']));
    for (const row of rows) if (!row.actor_label && row.actor_admin_id) row.actor_label = names.get(row.actor_admin_id) ?? 'Administrateur';
  }
  return rows.map(toEventView);
}

export async function countFeed(filters: Record<string, unknown>, cap = 10_000): Promise<{ total: number; capped: boolean }> {
  const { data, error } = await createServiceClient().rpc('audit_feed_count', { p_filters: filters, p_cap: cap });
  if (error) fail(error);
  const value = Number(data ?? 0);
  return { total: Math.min(value, cap), capped: value > cap };
}

export interface FeedSummary {
  total: number;
  failures: number;
  critical: number;
  warnings: number;
  actors: number;
  automationFailures: number;
  capped: boolean;
}

export async function summarizeFeed(filters: Record<string, unknown>): Promise<FeedSummary> {
  const { data, error } = await createServiceClient().rpc('audit_feed_summary', { p_filters: filters });
  if (error) fail(error);
  const value = (data ?? {}) as Record<string, unknown>;
  return {
    total: Number(value.total ?? 0), failures: Number(value.failures ?? 0), critical: Number(value.critical ?? 0),
    warnings: Number(value.warnings ?? 0), actors: Number(value.actors ?? 0),
    automationFailures: Number(value.automation_failures ?? 0), capped: Boolean(value.capped),
  };
}

export async function listFeedActors(filters: Record<string, unknown>): Promise<{ id: string; label: string }[]> {
  const { data, error } = await createServiceClient().rpc('audit_feed_actors', { p_filters: filters });
  if (error) fail(error);
  return ((data ?? []) as { actor_admin_id: string; actor_label: string | null }[])
    .map((row) => ({ id: row.actor_admin_id, label: maskText(row.actor_label ?? 'Administrateur') }));
}

/** One event by feed id, inside the admin's perimeter only (another tenant's id → null). */
export async function loadFeedEvent(scope: JournalScope, tenants: FeedTenantScope, id: string): Promise<AuditEventView | null> {
  if (!/^[a-z]{2}:[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await loadFeedPage(buildFeedFilters(scope, tenants, { id }), 1);
  return rows[0] ?? null;
}

export function moduleLabel(module: string): string {
  return (AUDIT_MODULES as Record<string, { label: string }>)[module]?.label ?? module;
}

export type { AuditModule };
