import { createServiceClient } from '@/lib/supabase/server';
import type { CrmCustomerListItem, RfmSegment, SegmentCondition, SegmentDefinition } from '@lepefy/types';

export const CRM_PAGE_SIZE = 30;
export const CRM_ATTRIBUTION_WINDOW_DAYS = 14;

export const SYSTEM_SEGMENTS = [
  { key: 'all', name: 'Tous les clients' },
  { key: 'new', name: 'Nouveaux' },
  { key: 'active', name: 'Actifs' },
  { key: 'loyal', name: 'Fidèles' },
  { key: 'vip', name: 'VIP' },
  { key: 'at_risk', name: 'À risque' },
  { key: 'inactive', name: 'Inactifs' },
  { key: 'one_time', name: 'Achat unique' },
  { key: 'loyalty', name: 'Fidélité' },
  { key: 'marketing', name: 'Marketing autorisé' },
  { key: 'events', name: 'Participants événements' },
] as const;

export const RFM_LABELS: Record<RfmSegment, string> = {
  champion: 'VIP', loyal: 'Fidèle', potential_loyalist: 'Potentiel fidèle', new: 'Nouveau',
  at_risk: 'À risque', hibernating: 'Inactif', lost: 'Perdu',
};

export interface CustomerListFilters {
  q?: string;
  segment?: string;
  source?: string;
  marketing?: boolean;
  loyalty?: boolean;
  minOrders?: number;
  maxOrders?: number;
  minLifetimeValue?: number;
  createdAfter?: string;
  createdBefore?: string;
  lastPurchaseBefore?: string;
  tagId?: string;
  page?: number;
  pageSize?: number;
  sort?: 'last_activity' | 'created' | 'spent' | 'orders' | 'name';
  direction?: 'asc' | 'desc';
}

const FIELD_COLUMN: Partial<Record<SegmentCondition['field'], string>> = {
  orders_count: 'orders_count', lifetime_value: 'lifetime_value', average_order_value: 'average_order_value',
  days_since_last_order: 'days_since_last_order', created_at: 'created_at', source: 'source',
  marketing_consent: 'marketing_consent', loyalty_points: 'loyalty_points_balance', rfm_segment: 'rfm_segment',
  favorite_category: 'favorite_category_id', favorite_product: 'favorite_product_id',
  event_participation: 'event_reservations_count',
};

export function validateSegmentDefinition(value: unknown): SegmentDefinition {
  if (!value || typeof value !== 'object') throw new Error('Définition de segment invalide.');
  const candidate = value as { operator?: unknown; conditions?: unknown };
  if (candidate.operator !== 'and' && candidate.operator !== 'or') throw new Error('Opérateur de groupe invalide.');
  if (!Array.isArray(candidate.conditions) || candidate.conditions.length > 12) throw new Error('Conditions de segment invalides.');
  const allowedOperators = new Set(['=','!=','>','>=','<','<=','contains','not_contains','before','after','in','not_in']);
  const conditions = candidate.conditions.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Condition invalide.');
    const condition = item as SegmentCondition;
    if (!(condition.field in FIELD_COLUMN) && condition.field !== 'tag') throw new Error(`Champ non autorisé: ${condition.field}`);
    if (!allowedOperators.has(condition.operator)) throw new Error(`Opérateur non autorisé: ${condition.operator}`);
    if (!['string','number','boolean'].includes(typeof condition.value) && !Array.isArray(condition.value)) throw new Error('Valeur invalide.');
    return condition;
  });
  return { operator: candidate.operator, conditions };
}

function applyCondition(query: any, condition: SegmentCondition) {
  const column = FIELD_COLUMN[condition.field];
  if (!column) return query;
  const value = condition.value;
  switch (condition.operator) {
    case '=': return query.eq(column, value);
    case '!=': return query.neq(column, value);
    case '>': return query.gt(column, value);
    case '>=': return query.gte(column, value);
    case '<': return query.lt(column, value);
    case '<=': return query.lte(column, value);
    case 'before': return query.lt(column, value);
    case 'after': return query.gt(column, value);
    case 'contains': return query.ilike(column, `%${String(value).replace(/[%_,()]/g, '')}%`);
    case 'not_contains': return query.not(column, 'ilike', `%${String(value).replace(/[%_,()]/g, '')}%`);
    case 'in': return query.in(column, Array.isArray(value) ? value : [value]);
    case 'not_in': return query.not(column, 'in', `(${(Array.isArray(value) ? value : [value]).join(',')})`);
  }
}

function applySystemSegment(query: any, key?: string) {
  switch (key) {
    case 'new': return query.eq('rfm_segment', 'new');
    case 'active': return query.lte('days_since_last_order', 90);
    case 'loyal': return query.in('rfm_segment', ['loyal','potential_loyalist']);
    case 'vip': return query.eq('rfm_segment', 'champion');
    case 'at_risk': return query.eq('rfm_segment', 'at_risk');
    case 'inactive': return query.in('rfm_segment', ['hibernating','lost']);
    case 'one_time': return query.eq('completed_orders_count', 1);
    case 'loyalty': return query.gt('loyalty_points_balance', 0);
    case 'marketing': return query.eq('marketing_consent', true);
    case 'events': return query.gt('event_reservations_count', 0);
    default: return query;
  }
}

async function tagCustomerIds(tenantId: string, tagId: string): Promise<string[]> {
  const { data, error } = await createServiceClient().from('customer_tag_assignments').select('customer_id')
    .eq('tenant_id', tenantId).eq('tag_id', tagId).limit(10000);
  if (error) throw error;
  return (data ?? []).map((row) => row.customer_id);
}

export async function getCustomers(tenantId: string, filters: CustomerListFilters = {}) {
  const supabase = createServiceClient();
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? CRM_PAGE_SIZE));
  const page = Math.max(1, filters.page ?? 1);
  const systemKeys = new Set(SYSTEM_SEGMENTS.map((segment) => segment.key));
  let customSegmentIds: string[] | null = null;
  if (filters.segment && !systemKeys.has(filters.segment as typeof SYSTEM_SEGMENTS[number]['key'])) {
    const { data: custom, error } = await supabase.from('customer_segments').select('definition_json')
      .eq('tenant_id', tenantId).eq('id', filters.segment).eq('kind', 'custom').eq('active', true).maybeSingle();
    if (error) throw error;
    if (custom) {
      const matched = await applyCustomSegment(tenantId, validateSegmentDefinition(custom.definition_json), 10000);
      customSegmentIds = matched.customers.map((customer) => customer.id);
      if (customSegmentIds.length === 0) return { customers: [] as CrmCustomerListItem[], count: 0, page, pageSize };
    }
  }
  let query: any = supabase.from('customer_crm_overview').select('*', { count: 'exact' }).eq('tenant_id', tenantId);
  if (customSegmentIds) query = query.in('id', customSegmentIds);
  if (filters.q?.trim()) query = query.textSearch('search_document', filters.q.trim().slice(0, 80), { type: 'websearch', config: 'simple' });
  query = applySystemSegment(query, filters.segment);
  if (filters.source) query = query.eq('source', filters.source);
  if (filters.marketing !== undefined) query = query.eq('marketing_consent', filters.marketing);
  if (filters.loyalty === true) query = query.gt('loyalty_points_balance', 0);
  if (filters.loyalty === false) query = query.eq('loyalty_points_balance', 0);
  if (filters.minOrders !== undefined) query = query.gte('orders_count', filters.minOrders);
  if (filters.maxOrders !== undefined) query = query.lte('orders_count', filters.maxOrders);
  if (filters.minLifetimeValue !== undefined) query = query.gte('lifetime_value', filters.minLifetimeValue);
  if (filters.createdAfter) query = query.gte('created_at', filters.createdAfter);
  if (filters.createdBefore) query = query.lte('created_at', `${filters.createdBefore}T23:59:59.999Z`);
  if (filters.lastPurchaseBefore) query = query.lte('last_order_at', `${filters.lastPurchaseBefore}T23:59:59.999Z`);
  if (filters.tagId) {
    const ids = await tagCustomerIds(tenantId, filters.tagId);
    if (ids.length === 0) return { customers: [] as CrmCustomerListItem[], count: 0, page, pageSize };
    query = query.in('id', ids);
  }
  const sortColumn = { last_activity: 'last_activity_at', created: 'created_at', spent: 'lifetime_value', orders: 'completed_orders_count', name: 'full_name' }[filters.sort ?? 'last_activity'];
  query = query.order(sortColumn, { ascending: filters.direction === 'asc', nullsFirst: false }).order('id', { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await query;
  if (error) throw error;
  return { customers: (data ?? []) as CrmCustomerListItem[], count: count ?? 0, page, pageSize };
}

export async function applyCustomSegment(
  tenantId: string,
  definition: SegmentDefinition,
  limit = CRM_PAGE_SIZE,
): Promise<{ customers: CrmCustomerListItem[]; count: number }> {
  const supabase = createServiceClient();
  const valid = validateSegmentDefinition(definition);
  if (valid.operator === 'or' && valid.conditions.length > 1) {
    const groups = await Promise.all(valid.conditions.map((condition) => applyCustomSegment(tenantId, { operator: 'and', conditions: [condition] }, 1000)));
    const unique = new Map(groups.flatMap((group) => group.customers).map((customer) => [customer.id, customer]));
    return { customers: [...unique.values()].slice(0, limit), count: unique.size };
  }
  let query: any = supabase.from('customer_crm_overview').select('*', { count: 'exact' }).eq('tenant_id', tenantId);
  for (const condition of valid.conditions.filter((item) => item.field !== 'tag')) query = applyCondition(query, condition);
  const tagConditions = valid.conditions.filter((item) => item.field === 'tag');
  for (const condition of tagConditions) {
    const ids = await tagCustomerIds(tenantId, String(condition.value));
    if (ids.length === 0) return { customers: [], count: 0 };
    query = condition.operator === '!=' || condition.operator === 'not_in' ? query.not('id', 'in', `(${ids.join(',')})`) : query.in('id', ids);
  }
  const { data, error, count } = await query.order('last_activity_at', { ascending: false }).limit(Math.min(10000, limit));
  if (error) throw error;
  return { customers: (data ?? []) as CrmCustomerListItem[], count: count ?? 0 };
}

export async function getCrmKpis(tenantId: string) {
  const supabase = createServiceClient();
  const base = () => supabase.from('customer_crm_overview').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  const [all, active, fresh, risk, marketing, repeat] = await Promise.all([
    base(), base().lte('days_since_last_order', 90), base().eq('rfm_segment', 'new'), base().eq('rfm_segment', 'at_risk'),
    base().eq('marketing_consent', true), base().gte('completed_orders_count', 2),
  ]);
  return { total: all.count ?? 0, active: active.count ?? 0, new: fresh.count ?? 0, atRisk: risk.count ?? 0, marketing: marketing.count ?? 0, repeat: repeat.count ?? 0 };
}

export async function getCustomerDetail(tenantId: string, customerId: string) {
  const supabase = createServiceClient();
  const [profile, orders, addresses, points, purchases, reservations, consents, notes, tags, campaigns, events] = await Promise.all([
    supabase.from('customer_crm_overview').select('*').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle(),
    supabase.from('orders').select('id,total,status,payment_status,payment_method,created_at').eq('tenant_id', tenantId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
    supabase.from('addresses').select('*').eq('tenant_id', tenantId).eq('customer_id', customerId).order('is_default', { ascending: false }),
    supabase.from('points_ledger').select('id,amount,status,transaction_type,created_at,reference_order_id').eq('tenant_id', tenantId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(100),
    supabase.from('loyalty_manual_purchases').select('id,amount,points_awarded,created_at').eq('tenant_id', tenantId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
    supabase.from('event_reservations').select('id,event_id,amount_paid,status,source,created_at,events(title),event_reservation_items(id,event_reservation_item_redemptions(quantity_redeemed,redeemed_at,voided_at))').eq('tenant_id', tenantId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
    supabase.from('user_consents').select('id,consent_type,granted,source,created_at').eq('tenant_id', tenantId).eq('user_id', customerId).order('created_at', { ascending: false }).limit(100),
    supabase.from('customer_notes').select('id,body,created_at,updated_at,author_admin_id,admin_users(first_name,last_name,email)').eq('tenant_id', tenantId).eq('customer_id', customerId).order('created_at', { ascending: false }),
    supabase.from('customer_tag_assignments').select('tag_id,customer_tags(id,name,color)').eq('tenant_id', tenantId).eq('customer_id', customerId),
    supabase.from('marketing_campaign_recipients').select('id,status,sent_at,delivered_at,opened_at,clicked_at,converted_at,marketing_campaigns(id,name,channel)').eq('tenant_id', tenantId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(50),
    supabase.from('customer_events').select('*').eq('tenant_id', tenantId).eq('customer_id', customerId).order('occurred_at', { ascending: false }).limit(100),
  ]);
  if (profile.error) throw profile.error;
  if (!profile.data) return null;
  return { profile: profile.data as CrmCustomerListItem, orders: orders.data ?? [], addresses: addresses.data ?? [], points: points.data ?? [], purchases: purchases.data ?? [], reservations: reservations.data ?? [], consents: consents.data ?? [], notes: notes.data ?? [], tags: tags.data ?? [], campaigns: campaigns.data ?? [], events: events.data ?? [] };
}
