import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { pageWindow, type PageWindow } from '@/lib/admin/listParams';
import { isUuid } from '../rules';
import type { SupportListParams, SupportView } from '../platformList';
import type { PlatformEvent, PlatformLink, PlatformMessage, PlatformTicket, PlatformTicketDetail } from '../types';

/**
 * Platform console reads (service role, platform owner checked by the caller).
 * The list is a server query over the full queue (view support_ticket_queue),
 * filtered and paginated in SQL.
 */

type Query = ReturnType<ReturnType<typeof createServiceClient>['from']>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Filterable = any;

function applyView(query: Filterable, view: SupportView, now: Date): Filterable {
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  switch (view) {
    case 'open': return query.not('status', 'in', '(resolved,closed)');
    case 'awaiting': return query.eq('awaiting_lepefy', true);
    case 'new': return query.eq('status', 'new');
    case 'urgent': return query.in('priority', ['high', 'critical']).not('status', 'in', '(resolved,closed)');
    case 'stale': return query.eq('stale', true);
    case 'waiting_tenant': return query.eq('status', 'waiting_tenant');
    case 'resolved': return query.in('status', ['resolved', 'closed']).gte('last_activity_at', since30);
    default: return query;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_,()]/g, (char) => (char === ',' || char === '(' || char === ')' ? ' ' : `\\${char}`));
}

function applyFilters(query: Filterable, params: SupportListParams, adminId: string): Filterable {
  let q = query;
  if (params.tenant) q = q.eq('tenant_id', params.tenant);
  if (params.status) q = q.eq('status', params.status);
  if (params.category) q = q.eq('category', params.category);
  if (params.priority) q = q.eq('priority', params.priority);
  if (params.assignee === 'me') q = q.eq('assignee_admin_id', adminId);
  else if (params.assignee === 'none') q = q.is('assignee_admin_id', null);
  else if (isUuid(params.assignee)) q = q.eq('assignee_admin_id', params.assignee);
  if (params.from) q = q.gte('created_at', `${params.from}T00:00:00Z`);
  if (params.to) q = q.lte('created_at', `${params.to}T23:59:59Z`);
  if (params.q) {
    const term = params.q.replace(/^#|^n°\s*/i, '').trim();
    if (/^\d{1,12}$/.test(term)) q = q.eq('number', Number(term));
    else {
      const like = `%${escapeLike(term)}%`;
      q = q.or(`title.ilike.${like},summary.ilike.${like},requester_label.ilike.${like},tenant_name.ilike.${like}`);
    }
  }
  return q;
}

const LIST_COLUMNS = 'id, number, tenant_id, tenant_name, tenant_slug, origin, source_channel, requester_label, title, summary, category, status, priority, declared_urgent, assignee_admin_id, visible_to_tenant, context, resource_label, created_at, last_activity_at, last_tenant_message_at, last_staff_reply_at, awaiting_lepefy, stale, attention_rank, merged_into_ticket_id, reopen_count';

export type PlatformListRow = Pick<PlatformTicket,
  'id' | 'number' | 'tenant_id' | 'tenant_name' | 'tenant_slug' | 'origin' | 'source_channel' | 'requester_label' | 'title' | 'summary'
  | 'category' | 'status' | 'priority' | 'declared_urgent' | 'assignee_admin_id' | 'visible_to_tenant' | 'context' | 'resource_label'
  | 'created_at' | 'last_activity_at' | 'last_tenant_message_at' | 'last_staff_reply_at' | 'awaiting_lepefy' | 'stale' | 'attention_rank'
  | 'merged_into_ticket_id' | 'reopen_count'> & { unread: boolean; attachments: number };

export async function platformTicketList(params: SupportListParams, adminId: string, now = new Date()): Promise<{ rows: PlatformListRow[]; window: PageWindow }> {
  const db = createServiceClient();
  const build = (columns: string, head = false) => {
    let query: Filterable = (db.from('support_ticket_queue') as Query).select(columns, head ? { count: 'exact', head: true } : { count: 'exact' });
    query = applyView(query, params.view as SupportView, now);
    return applyFilters(query, params, adminId);
  };
  const { count, error: countError } = await build('id', true);
  if (countError) throw countError;
  const window = pageWindow(count ?? 0, params.page, params.pageSize);
  let query = build(LIST_COLUMNS);
  if (params.sort === 'newest') query = query.order('created_at', { ascending: false });
  else if (params.sort === 'oldest') query = query.order('created_at', { ascending: true });
  else if (params.sort === 'activity') query = query.order('last_activity_at', { ascending: false });
  else query = query.order('attention_rank', { ascending: true }).order('last_activity_at', { ascending: false });
  const { data, error } = await query.order('id').range(window.rangeFrom, window.rangeTo);
  if (error) throw error;
  const rows = (data ?? []) as PlatformListRow[];
  const ids = rows.map((row) => row.id);
  const [reads, files] = ids.length ? await Promise.all([
    db.from('support_read_states').select('ticket_id, last_read_at').eq('admin_id', adminId).in('ticket_id', ids),
    db.from('support_attachments').select('ticket_id').in('ticket_id', ids).not('message_id', 'is', null),
  ]) : [{ data: [] }, { data: [] }];
  const readAt = new Map(((reads.data ?? []) as Array<{ ticket_id: string; last_read_at: string }>).map((row) => [row.ticket_id, row.last_read_at]));
  const fileCount = new Map<string, number>();
  for (const row of (files.data ?? []) as Array<{ ticket_id: string }>) fileCount.set(row.ticket_id, (fileCount.get(row.ticket_id) ?? 0) + 1);
  return {
    window,
    rows: rows.map((row) => {
      const read = readAt.get(row.id);
      const last = row.last_tenant_message_at ?? row.created_at;
      return { ...row, unread: !read || Date.parse(last) > Date.parse(read), attachments: fileCount.get(row.id) ?? 0 };
    }),
  };
}

export interface SupportKpis { awaiting: number; new: number; urgent: number; stale: number; waiting_tenant: number; resolved: number }

export async function platformKpis(now = new Date()): Promise<SupportKpis> {
  const db = createServiceClient();
  const views: Array<keyof SupportKpis> = ['awaiting', 'new', 'urgent', 'stale', 'waiting_tenant', 'resolved'];
  const counts = await Promise.all(views.map(async (view) => {
    const { count } = await applyView((db.from('support_ticket_queue') as Query).select('id', { count: 'exact', head: true }), view, now);
    return count ?? 0;
  }));
  return Object.fromEntries(views.map((view, index) => [view, counts[index]])) as unknown as SupportKpis;
}

/** Requests waiting for Lepefy (platform menu badge). */
export async function platformAwaitingCount(): Promise<number> {
  const { count, error } = await createServiceClient().from('support_ticket_queue').select('id', { count: 'exact', head: true }).eq('awaiting_lepefy', true);
  return error ? 0 : count ?? 0;
}

export async function platformOwners(): Promise<Array<{ id: string; label: string }>> {
  const { data } = await createServiceClient().from('admin_users')
    .select('id, email, first_name, last_name, nickname').eq('role', 'platform_owner').eq('active', true);
  return ((data ?? []) as Array<{ id: string; email: string | null; first_name: string | null; last_name: string | null; nickname: string | null }>)
    .map((row) => ({ id: row.id, label: row.nickname || [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || 'Lepefy' }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

export async function platformTicketDetail(ticketId: string, adminId: string): Promise<PlatformTicketDetail | null> {
  if (!isUuid(ticketId)) return null;
  const db = createServiceClient();
  const { data: ticket, error } = await db.from('support_ticket_queue').select('*').eq('id', ticketId).maybeSingle();
  if (error) throw error;
  if (!ticket) return null;
  const t = ticket as PlatformTicket;
  const [messages, attachments, events, links, mergedFrom, mergedInto, read] = await Promise.all([
    db.from('support_messages').select('id, author_type, author_admin_id, author_label, kind, body, relayed_from, original_sent_at, created_at').eq('ticket_id', t.id).order('created_at'),
    db.from('support_attachments').select('id, message_id, mime_type, width, height, internal, created_at').eq('ticket_id', t.id).not('message_id', 'is', null).order('created_at'),
    db.from('support_events').select('id, event_type, actor_type, actor_admin_id, from_value, to_value, public, created_at').eq('ticket_id', t.id).order('created_at'),
    db.from('support_links').select('id, kind, url, label, created_at').eq('ticket_id', t.id).order('created_at'),
    db.from('support_tickets').select('id, number').eq('merged_into_ticket_id', t.id),
    t.merged_into_ticket_id ? db.from('support_tickets').select('id, number').eq('id', t.merged_into_ticket_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('support_read_states').select('last_read_at').eq('ticket_id', t.id).eq('admin_id', adminId).maybeSingle(),
  ]);
  const files = new Map<string, PlatformMessage['attachments']>();
  for (const row of (attachments.data ?? []) as Array<{ id: string; message_id: string; mime_type: string; width: number | null; height: number | null; internal: boolean }>) {
    files.set(row.message_id, [...(files.get(row.message_id) ?? []), { id: row.id, mime_type: row.mime_type, width: row.width, height: row.height, internal: row.internal }]);
  }
  const messageRows = ((messages.data ?? []) as Array<Omit<PlatformMessage, 'attachments'>>).map((row) => ({ ...row, attachments: files.get(row.id) ?? [] }));
  const eventRows = (events.data ?? []) as PlatformEvent[];
  const personIds = new Set<string>();
  for (const id of [t.requester_admin_id, t.assignee_admin_id, t.created_by_admin_id, ...messageRows.map((m) => m.author_admin_id), ...eventRows.map((e) => e.actor_admin_id)]) {
    if (id) personIds.add(id);
  }
  const { data: people } = personIds.size
    ? await db.from('admin_users').select('id, email, first_name, last_name, nickname').in('id', [...personIds])
    : { data: [] };
  return {
    ticket: t,
    messages: messageRows,
    events: eventRows,
    links: (links.data ?? []) as PlatformLink[],
    mergedFrom: (mergedFrom.data ?? []) as Array<{ id: string; number: number }>,
    mergedInto: (mergedInto.data as { id: string; number: number } | null) ?? null,
    people: Object.fromEntries(((people ?? []) as Array<{ id: string; email: string | null; first_name: string | null; last_name: string | null; nickname: string | null }>)
      .map((row) => [row.id, row.nickname || [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || 'Admin'])),
    lastReadAt: (read.data as { last_read_at: string } | null)?.last_read_at ?? null,
  };
}

/** Tenants offered in the filters and the manual form. */
export async function supportTenants(): Promise<Array<{ id: string; name: string; isTest: boolean }>> {
  const { data } = await createServiceClient().from('tenants').select('id, name, is_test').order('name');
  return ((data ?? []) as Array<{ id: string; name: string; is_test: boolean | null }>).map((row) => ({ id: row.id, name: row.name, isTest: row.is_test === true }));
}
