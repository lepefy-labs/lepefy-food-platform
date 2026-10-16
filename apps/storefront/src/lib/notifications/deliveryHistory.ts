import type { SupabaseClient } from '@supabase/supabase-js';
import { defineListParams, pageWindow, type ListParamValues, type PageWindow } from '@/lib/admin/listParams';

/**
 * Platform-owner delivery history (notification_deliveries, migrations
 * 136/137/158): URL state, server-side filters and pagination over the whole
 * ledger of one tenant. Payloads are never read here.
 */
export const DELIVERY_LIST = defineListParams({
  q: { type: 'search' },
  status: { type: 'enum', values: ['all', 'sent', 'delivered', 'problems', 'unknown', 'in_progress', 'skipped'], default: 'all' },
  channel: { type: 'enum', values: ['all', 'email', 'whatsapp'], default: 'all' },
  tenant: { type: 'uuid' },
  from: { type: 'date' },
  to: { type: 'date' },
}, { pageSizes: [25, 50, 100], defaultPageSize: 50 });

export type DeliveryListValues = ListParamValues<typeof DELIVERY_LIST.spec>;

export const DELIVERY_STATUS_GROUPS: Record<string, string[]> = {
  sent: ['accepted', 'delivered'],
  delivered: ['delivered'],
  problems: ['failed', 'dead'],
  unknown: ['unknown'],
  in_progress: ['pending', 'processing'],
  skipped: ['skipped'],
};

export interface DeliveryHistoryRow {
  id: string;
  notification_type: string;
  channel: 'email' | 'whatsapp';
  subject: string | null;
  recipients: string[];
  status: 'pending' | 'processing' | 'accepted' | 'delivered' | 'failed' | 'dead' | 'skipped' | 'unknown';
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  accepted_at: string | null;
  delivered_at: string | null;
  transport: string | null;
  provider_message_id: string | null;
  provider_status: string | null;
  recipient_id: string | null;
  retryable: boolean;
  event: { entity_type: string; entity_id: string; source: string } | null;
}

const COLUMNS = 'id, notification_type, channel, subject, recipients, status, attempts, max_attempts, next_attempt_at, last_error, created_at, accepted_at, delivered_at, transport, provider_message_id, provider_status, recipient_id, retryable:payload, event:tenant_notification_events(entity_type, entity_id, source)';

/** UTC day bounds (support use; the ledger stores UTC). */
function dayBounds(values: Pick<DeliveryListValues, 'from' | 'to'>) {
  return {
    from: values.from ? `${values.from}T00:00:00Z` : null,
    to: values.to ? new Date(Date.parse(`${values.to}T00:00:00Z`) + 86_400_000).toISOString() : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters<Q extends { eq: any; in: any; gte: any; lt: any; or: any }>(query: Q, values: DeliveryListValues): Q {
  let q = query;
  if (values.status !== 'all') q = q.in('status', DELIVERY_STATUS_GROUPS[values.status] ?? []);
  if (values.channel !== 'all') q = q.eq('channel', values.channel);
  const bounds = dayBounds(values);
  if (bounds.from) q = q.gte('created_at', bounds.from);
  if (bounds.to) q = q.lt('created_at', bounds.to);
  if (values.q) {
    // listParams' search keeps only letters, digits and « @._+-# »: safe inside or().
    const like = `%${values.q.replace(/[%_]/g, '')}%`;
    q = q.or(`subject.ilike.${like},notification_type.ilike.${like},last_error.ilike.${like},provider_message_id.ilike.${like},idempotency_key.ilike.${like}`);
  }
  return q;
}

export async function loadDeliveryHistory(db: SupabaseClient, tenantId: string, values: DeliveryListValues): Promise<{ rows: DeliveryHistoryRow[]; window: PageWindow }> {
  const countQuery = applyFilters(db.from('notification_deliveries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId), values);
  const { count, error: countError } = await countQuery;
  if (countError) throw countError;
  const window = pageWindow(count ?? 0, values.page, values.pageSize);
  if ((count ?? 0) === 0) return { rows: [], window };
  const { data, error } = await applyFilters(db.from('notification_deliveries').select(COLUMNS).eq('tenant_id', tenantId), values)
    .order('created_at', { ascending: false }).range(window.rangeFrom, window.rangeTo);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as Array<Omit<DeliveryHistoryRow, 'retryable' | 'event'> & { retryable: unknown; event: unknown }>)
    .map(({ retryable, event, ...row }) => ({
      ...row,
      retryable: retryable != null,
      event: (Array.isArray(event) ? event[0] : event) as DeliveryHistoryRow['event'] ?? null,
    }));
  return { rows, window };
}

/** CSV export of the same filtered list (max 2 000 rows). */
export async function loadDeliveryExport(db: SupabaseClient, tenantId: string, values: DeliveryListValues): Promise<DeliveryHistoryRow[]> {
  const { data, error } = await applyFilters(db.from('notification_deliveries').select(COLUMNS).eq('tenant_id', tenantId), values)
    .order('created_at', { ascending: false }).limit(2000);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<Omit<DeliveryHistoryRow, 'retryable' | 'event'> & { retryable: unknown; event: unknown }>)
    .map(({ retryable, event, ...row }) => ({ ...row, retryable: retryable != null, event: (Array.isArray(event) ? event[0] : event) as DeliveryHistoryRow['event'] ?? null }));
}

export const DELIVERY_TYPE_LABELS: Record<string, string> = {
  order_confirmed: 'Commande confirmée', order_shipped: 'Commande expédiée', order_ready_for_pickup: 'Prête au retrait',
  order_completed: 'Commande terminée', order_cancelled: 'Commande annulée', order_stock_conflict: 'Conflit de stock',
  payment_reminder: 'Relance paiement', card_quick_payment: 'Paiement carte', card_quick_payment_customer: 'Paiement carte (client)', event_reservation_confirmed: 'Réservation événement',
  event_capacity_conflict: 'Événement complet', rental_stock_conflict: 'Matériel indisponible',
  service_inquiry_created: 'Demande de devis', rental_reservation_confirmed_customer: 'Réservation matériel (client)',
  rental_reservation_confirmed_admin: 'Réservation matériel (équipe)', rental_delivery_quote_pending: 'Livraison à chiffrer',
  external_payment_awaiting_verification: 'Paiement externe à vérifier', event_external_payment_awaiting_verification: 'Réservation à vérifier',
  review_invite: 'Invitation avis', tester_feedback_invite: 'Invitation testeur', event_booking_closed_reports: 'Rapports de clôture',
  marketing_campaign: 'Campagne marketing', daily_order_digest: 'Rapport quotidien (08h)',
  order_created: 'Nouvelle commande (équipe)', external_payment_pending: 'Paiement à vérifier (équipe)', order_attention_required: 'Commande à vérifier',
  shipment_creation_failed: 'Expédition non créée', shipment_action_required: 'Expédition à vérifier', shipment_delayed: 'Livraison en retard',
  service_inquiries: 'Demande de devis (équipe)', rental_reservations: 'Réservation matériel (équipe)', event_reservation_created: 'Nouvelle réservation (équipe)',
  subscription_billing: 'Abonnement Lepefy', order_backlog_summary: 'Rattrapage · récapitulatif', staff_test: 'Message de test',
};

/** Admin link of the resource behind a dispatcher event. */
export function deliveryResourceHref(event: DeliveryHistoryRow['event']): string | null {
  if (!event) return null;
  if (event.entity_type === 'order') return `/admin/orders/${event.entity_id}`;
  if (event.entity_type === 'checkout_session') return `/admin/paiements-en-attente/${event.entity_id}`;
  if (event.entity_type === 'notification_backfill_run') return `/admin/platform/notifications/rattrapage?run=${event.entity_id}`;
  return null;
}
