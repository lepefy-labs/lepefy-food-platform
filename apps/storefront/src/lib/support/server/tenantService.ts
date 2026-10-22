import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canAdmin, type AdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import type { SupportResourceType } from '../domain';
import { isUuid } from '../rules';
import type { TenantThread, TenantTicketRow } from '../types';

/**
 * Shop-side reads. Every read goes through the 163 RPCs that only return the
 * public projection of the shop's own requests (never notes, internal files,
 * links, priority or assignee), with the tenant passed by the server.
 */

export const TENANT_PAGE_SIZE = 20;

export async function tenantTicketPage(input: {
  tenantId: string; adminId: string; view: 'open' | 'done'; search: string; page: number;
}): Promise<{ rows: TenantTicketRow[]; total: number }> {
  const { data, error } = await createServiceClient().rpc('support_tenant_ticket_page', {
    p_tenant_id: input.tenantId,
    p_admin_id: input.adminId,
    p_view: input.view,
    p_search: input.search.slice(0, 100),
    p_offset: (Math.max(1, input.page) - 1) * TENANT_PAGE_SIZE,
    p_limit: TENANT_PAGE_SIZE,
  });
  if (error) throw error;
  const rows = (data ?? []) as Array<TenantTicketRow & { total: number }>;
  return { rows: rows.map(({ total: _total, ...row }) => row), total: Number(rows[0]?.total ?? 0) };
}

export async function tenantThread(tenantId: string, ticketId: string, adminId: string): Promise<TenantThread | null> {
  if (!isUuid(ticketId)) return null;
  const { data, error } = await createServiceClient().rpc('support_tenant_thread', {
    p_tenant_id: tenantId, p_ticket_id: ticketId, p_admin_id: adminId,
  });
  if (error) throw error;
  return (data as TenantThread | null) ?? null;
}

/** Requests with a Lepefy update the admin has not opened yet (menu badge). */
export async function tenantUnreadCount(tenantId: string, adminId: string): Promise<number> {
  const { data, error } = await createServiceClient().rpc('support_tenant_unread_count', { p_tenant_id: tenantId, p_admin_id: adminId });
  if (error) {
    console.error('[support] unread count unavailable:', error.code ?? error.message?.slice(0, 80));
    return 0;
  }
  return Number(data ?? 0);
}

export async function similarTickets(tenantId: string, text: string): Promise<Array<{ id: string; number: number; title: string; tenant_status: string }>> {
  const { data, error } = await createServiceClient().rpc('support_similar_tickets', { p_tenant_id: tenantId, p_text: text.slice(0, 1000), p_limit: 3 });
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; number: number; title: string; tenant_status: string }>)
    .map(({ id, number, title, tenant_status }) => ({ id, number, title, tenant_status }));
}

const RESOURCE_PERMISSION: Record<SupportResourceType, string> = {
  order: 'orders.view',
  product: 'catalog.view',
  customer: 'customers.view',
};

/**
 * Resource of the page the request comes from, kept only when it belongs to
 * the shop and the admin may open it. A customer is never named (personal data).
 */
export async function verifySupportResource(
  tenantId: string,
  access: AdminAccessContext,
  resource: { type: unknown; id: unknown } | null,
  db: SupabaseClient = createServiceClient(),
): Promise<{ type: SupportResourceType; id: string; label: string } | null> {
  if (!resource || !isUuid(resource.id)) return null;
  const type = resource.type;
  if (type !== 'order' && type !== 'product' && type !== 'customer') return null;
  if (!canAdmin(access, RESOURCE_PERMISSION[type])) return null;
  const id = resource.id.toLowerCase();
  if (type === 'order') {
    const { data } = await db.from('orders').select('id').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    return data ? { type, id, label: `Commande #${id.slice(0, 8).toUpperCase()}` } : null;
  }
  if (type === 'product') {
    const { data } = await db.from('products').select('id, name').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    const row = data as { name?: string | null } | null;
    return row ? { type, id, label: `Produit ${String(row.name ?? '').slice(0, 100)}`.trim() } : null;
  }
  const { data } = await db.from('customers').select('id').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  return data ? { type, id, label: 'Fiche client' } : null;
}
