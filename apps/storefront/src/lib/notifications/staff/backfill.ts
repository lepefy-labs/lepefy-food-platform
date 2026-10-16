import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { defineListParams, type ListParamValues } from '@/lib/admin/listParams';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { readGreenApiOutboundConfig } from '@/lib/notifications/providers/greenApiOutbound';
import { attemptQueuedDelivery } from '@/lib/notifications/deliveryLedger';
import { routeDelivery } from '@/lib/notifications/deliveryRouter';
import { recordAuditEvent } from '@/lib/audit/recordAuditEvent';
import type { AdminAccessContext } from '@/lib/auth/adminRbac';
import type { NotificationChannel } from '@/lib/notifications/notificationTypes';
import { defaultDispatchDeps, deliveryKey, dispatchTenantNotification } from './dispatcher';
import { loadOrderForNotification, notifyOrderCreated, orderCreatedAudience, orderFactsFrom } from './orderEvents';
import { backlogSummaryAlert, type BacklogOrderLine } from './staffMessages';
import { STAFF_WHATSAPP_FLAG } from './staffWhatsapp';
import {
  BACKFILL_DEFAULT_STATUSES, BACKFILL_MAX_ORDERS, BACKFILL_OPEN_STATUSES, buildBackfillPlan, orderIdRange, classifyOrder, orderPairs, planFingerprintSource,
  type BackfillMode, type BackfillOrder, type BackfillPlan, type BackfillState, type ExistingDelivery, type RecipientTargets,
} from './backfillPlan';

/**
 * Server side of the « Rattrapage des commandes » (platform owner only, see
 * docs/NOTIFICATION_SUBSCRIPTIONS.md): dataset loading, preview (persisted
 * run with fingerprint) and confirmation. Never changes an order, a payment
 * or a shipment, never reruns a conversion side effect: it only creates the
 * missing « Nouvelle commande » notifications through the dispatcher (same
 * event identity as the live notification, so nothing is sent twice).
 */

export const BACKFILL_LIST = defineListParams({
  tenant: { type: 'uuid' },
  q: { type: 'search' },
  from: { type: 'date' },
  to: { type: 'date' },
  status: { type: 'enum', values: ['open', 'new', 'preparing', 'ready_for_pickup'], default: 'open' },
  payment: { type: 'enum', values: ['all', 'stripe', 'in_store', 'external_link', 'manual'], default: 'all' },
  fulfillment: { type: 'enum', values: ['all', 'delivery', 'pickup'], default: 'all' },
  intl: { type: 'bool' },
  fresh: { type: 'bool' },
  notif: { type: 'enum', values: ['all', 'not_notified', 'failed', 'pending', 'partial', 'notified', 'no_target'], default: 'all' },
}, { pageSizes: [25, 50, 100], defaultPageSize: 50 });

export type BackfillListValues = ListParamValues<typeof BACKFILL_LIST.spec>;

const DATASET_CAP = 1000;
const PREVIEW_TTL_MS = 15 * 60_000;
const IMMEDIATE_SENDS = 10;
const AUDIENCE = ['order_created', 'order_international', 'order_fresh_products'];

export interface BackfillRow extends BackfillOrder {
  state: BackfillState;
  pairs: number;
  sent: number;
  missing: number;
  retry: number;
  uncertain: number;
}

export interface BackfillContext {
  targets: RecipientTargets;
  whatsappEnabled: boolean;
  whatsappConfigured: boolean;
}

interface OrderRow {
  id: string; tenant_id: string; full_name: string | null; total: number; fulfillment_type: 'delivery' | 'pickup';
  shipping_address: { country?: string } | null; payment_method: string | null; payment_status: string; status: string;
  external_payment_label: string | null; is_test: boolean | null; order_origin?: string | null; created_at: string; updated_at: string;
}

const ORDER_COLUMNS = 'id, tenant_id, full_name, total, fulfillment_type, shipping_address, payment_method, payment_status, status, external_payment_label, is_test, order_origin, created_at, updated_at';

function statusesFor(values: Pick<BackfillListValues, 'status'>): string[] {
  return values.status === 'open' ? [...BACKFILL_DEFAULT_STATUSES] : [values.status];
}

export async function loadBackfillContext(db: SupabaseClient, tenantId: string): Promise<BackfillContext> {
  const whatsappEnabled = await isFeatureEnabled(tenantId, STAFF_WHATSAPP_FLAG);
  const targets: RecipientTargets = { email: new Map(), whatsapp: new Map() };
  for (const channel of ['email', 'whatsapp'] as const) {
    if (channel === 'whatsapp' && !whatsappEnabled) continue;
    const { data, error } = await db.rpc('notification_recipient_targets', { p_tenant_id: tenantId, p_type_keys: AUDIENCE, p_channel: channel });
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ recipient_id: string; type_key: string }>) {
      const keys = targets[channel].get(row.recipient_id) ?? new Set<string>();
      keys.add(row.type_key);
      targets[channel].set(row.recipient_id, keys);
    }
  }
  return { targets, whatsappEnabled, whatsappConfigured: readGreenApiOutboundConfig().ok };
}

async function toBackfillOrders(db: SupabaseClient, tenantId: string, rows: OrderRow[]): Promise<BackfillOrder[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [{ data: items }, { data: tenant }] = await Promise.all([
    db.from('order_items').select('order_id, quantity, storage_type').eq('tenant_id', tenantId).in('order_id', ids),
    db.from('tenants').select('country, shipping_provider').eq('id', tenantId).maybeSingle(),
  ]);
  const lines = new Map<string, Array<{ quantity: number; storage_type: string | null }>>();
  for (const item of (items ?? []) as Array<{ order_id: string; quantity: number; storage_type: string | null }>) {
    lines.set(item.order_id, [...(lines.get(item.order_id) ?? []), item]);
  }
  return rows.map((row) => {
    const { facts, priority } = orderFactsFrom(row, lines.get(row.id) ?? [], (tenant ?? {}) as { country?: string | null; shipping_provider?: string | null });
    return {
      id: row.id, orderNumber: facts.orderNumber, customer: facts.customer, total: facts.total, status: row.status,
      paymentStatus: row.payment_status, paymentMethod: row.payment_method, isTest: row.is_test === true, fulfillment: row.fulfillment_type,
      international: facts.international, fresh: facts.fresh, frozen: facts.frozen, priority, createdAt: row.created_at, updatedAt: row.updated_at,
      audience: orderCreatedAudience(facts),
    };
  });
}

/** Existing « Nouvelle commande » deliveries and catch-up summaries per order. */
async function loadNotificationState(db: SupabaseClient, tenantId: string, orderIds: string[]) {
  const existing = new Map<string, ExistingDelivery[]>();
  const covered = new Map<string, Set<string>>();
  if (orderIds.length === 0) return { existing, covered };
  const { data: events, error } = await db.from('tenant_notification_events').select('id, entity_id')
    .eq('tenant_id', tenantId).eq('event_type', 'order_created').eq('entity_type', 'order').in('entity_id', orderIds);
  if (error) throw error;
  const orderByEvent = new Map(((events ?? []) as Array<{ id: string; entity_id: string }>).map((event) => [event.id, event.entity_id]));
  if (orderByEvent.size > 0) {
    const { data: rows, error: deliveryError } = await db.from('notification_deliveries').select('id, event_id, recipient_id, channel, status')
      .eq('tenant_id', tenantId).in('event_id', Array.from(orderByEvent.keys()));
    if (deliveryError) throw deliveryError;
    for (const row of (rows ?? []) as Array<{ id: string; event_id: string; recipient_id: string | null; channel: NotificationChannel; status: ExistingDelivery['status'] }>) {
      const orderId = orderByEvent.get(row.event_id);
      if (!orderId || !row.recipient_id) continue;
      existing.set(orderId, [...(existing.get(orderId) ?? []), { id: row.id, orderId, recipientId: row.recipient_id, channel: row.channel, status: row.status }]);
    }
  }
  const { data: runs } = await db.from('notification_backfill_runs').select('id, order_ids, result')
    .eq('tenant_id', tenantId).eq('mode', 'summary').eq('status', 'completed').overlaps('order_ids', orderIds).limit(100);
  const summaryRuns = (runs ?? []) as Array<{ id: string; order_ids: string[]; result: { delivery_ids?: string[] } | null }>;
  const summaryIds = summaryRuns.flatMap((run) => run.result?.delivery_ids ?? []);
  if (summaryIds.length > 0) {
    const { data: rows } = await db.from('notification_deliveries').select('id, recipient_id, channel, status')
      .eq('tenant_id', tenantId).in('id', summaryIds.slice(0, 1000)).in('status', ['accepted', 'delivered']);
    const okById = new Map(((rows ?? []) as Array<{ id: string; recipient_id: string | null; channel: string }>).map((row) => [row.id, row]));
    for (const run of summaryRuns) {
      for (const deliveryId of run.result?.delivery_ids ?? []) {
        const row = okById.get(deliveryId);
        if (!row?.recipient_id) continue;
        for (const orderId of run.order_ids) {
          const set = covered.get(orderId) ?? new Set<string>();
          set.add(`${row.recipient_id}:${row.channel}`);
          covered.set(orderId, set);
        }
      }
    }
  }
  return { existing, covered };
}

/** Rows of the catch-up list (every open order matching the filters, classified). */
export async function loadBackfillRows(db: SupabaseClient, tenantId: string, values: BackfillListValues, context: BackfillContext): Promise<{ rows: BackfillRow[]; capped: boolean }> {
  let query = db.from('orders').select(ORDER_COLUMNS).eq('tenant_id', tenantId).in('status', statusesFor(values))
    .or('payment_status.eq.paid,and(payment_method.eq.in_store,payment_status.eq.pending)')
    .or('is_test.is.null,is_test.eq.false');
  if (values.from) query = query.gte('created_at', `${values.from}T00:00:00Z`);
  if (values.to) query = query.lt('created_at', new Date(Date.parse(`${values.to}T00:00:00Z`) + 86_400_000).toISOString());
  if (values.payment !== 'all') query = query.eq('payment_method', values.payment);
  if (values.fulfillment !== 'all') query = query.eq('fulfillment_type', values.fulfillment);
  const range = orderIdRange(values.q);
  if (range) query = query.gte('id', range[0]).lte('id', range[1]);
  else if (values.q) query = query.ilike('full_name', `%${values.q.replace(/[%_]/g, '')}%`);
  const { data, error } = await query.order('created_at', { ascending: true }).limit(DATASET_CAP + 1);
  if (error) throw error;
  const raw = (data ?? []) as OrderRow[];
  const orders = await toBackfillOrders(db, tenantId, raw.slice(0, DATASET_CAP));
  const { existing, covered } = await loadNotificationState(db, tenantId, orders.map((order) => order.id));
  const channels: NotificationChannel[] = context.whatsappEnabled ? ['email', 'whatsapp'] : ['email'];
  const rows = orders.map((order) => {
    const state = classifyOrder(orderPairs(order, context.targets, channels), existing.get(order.id) ?? [], covered.get(order.id));
    return {
      ...order, state: state.state, pairs: state.pairs.length, sent: state.sent, missing: state.missing.length,
      retry: state.retry.length, uncertain: state.uncertain,
    };
  }).filter((row) => (values.intl === undefined || (row.international === true) === values.intl)
    && (values.fresh === undefined || (row.fresh || row.frozen) === values.fresh)
    && (values.notif === 'all' || row.state === values.notif));
  return { rows, capped: raw.length > DATASET_CAP };
}

export interface PreviewRequest {
  orderIds?: string[];
  allMatching?: BackfillListValues;
  channels: NotificationChannel[];
  mode: BackfillMode;
}

async function planFor(db: SupabaseClient, tenantId: string, orderIds: string[], channels: NotificationChannel[], mode: BackfillMode, context: BackfillContext) {
  const unique = Array.from(new Set(orderIds)).slice(0, BACKFILL_MAX_ORDERS);
  const { data, error } = await db.from('orders').select(ORDER_COLUMNS).eq('tenant_id', tenantId).in('id', unique);
  if (error) throw error;
  const orders = await toBackfillOrders(db, tenantId, (data ?? []) as OrderRow[]);
  const found = new Set(orders.map((order) => order.id));
  const { existing, covered } = await loadNotificationState(db, tenantId, orders.map((order) => order.id));
  const usable = channels.filter((channel) => channel === 'email' || (context.whatsappEnabled && context.whatsappConfigured));
  const plan = buildBackfillPlan({ orders, missingIds: unique.filter((id) => !found.has(id)), targets: context.targets, existing, covered, channels: usable, mode });
  const fingerprint = createHash('sha256').update(planFingerprintSource(orders, plan)).digest('hex');
  return { orders, plan, fingerprint, usable };
}

export interface PreviewResult {
  runId: string;
  expiresAt: string;
  plan: BackfillPlan;
  warnings: string[];
}

export function previewWarnings(channels: NotificationChannel[], context: BackfillContext): string[] {
  const warnings: string[] = [];
  if (channels.includes('whatsapp') && !context.whatsappEnabled) warnings.push('WhatsApp n’est pas activé pour cette boutique : aucun message WhatsApp ne sera envoyé.');
  else if (channels.includes('whatsapp') && !context.whatsappConfigured) warnings.push('Le service WhatsApp Lepefy n’est pas configuré sur ce déploiement : aucun message WhatsApp ne sera envoyé.');
  else if (channels.includes('whatsapp') && context.targets.whatsapp.size === 0) warnings.push('Aucun destinataire avec un numéro WhatsApp confirmé et abonné à « Nouvelle commande ».');
  if (channels.includes('email') && context.targets.email.size === 0) warnings.push('Aucun destinataire email abonné à « Nouvelle commande ».');
  return warnings;
}

export async function previewBackfill(db: SupabaseClient, input: {
  tenantId: string; actor: AdminAccessContext; idempotencyKey: string; request: PreviewRequest; now?: Date;
}): Promise<PreviewResult | { error: string; status: number }> {
  const now = input.now ?? new Date();
  const context = await loadBackfillContext(db, input.tenantId);
  let ids = input.request.orderIds ?? [];
  if (input.request.allMatching) {
    const { rows } = await loadBackfillRows(db, input.tenantId, input.request.allMatching, context);
    ids = rows.filter((row) => row.missing > 0 || row.retry > 0).map((row) => row.id);
  }
  if (ids.length === 0) return { error: 'Aucune commande à notifier dans la sélection.', status: 400 };
  if (ids.length > BACKFILL_MAX_ORDERS) return { error: `Au plus ${BACKFILL_MAX_ORDERS} commandes par rattrapage : affinez les filtres.`, status: 400 };
  const { plan, fingerprint } = await planFor(db, input.tenantId, ids, input.request.channels, input.request.mode, context);
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS).toISOString();
  const { data, error } = await db.from('notification_backfill_runs').upsert({
    tenant_id: input.tenantId, idempotency_key: input.idempotencyKey, status: 'previewed', mode: input.request.mode,
    channels: input.request.channels, filters: input.request.allMatching ?? {}, order_ids: ids, fingerprint,
    planned: { messages: plan.messages, newDeliveries: plan.newDeliveries, retries: plan.retries, recipients: plan.recipients, eligible: plan.eligibleIds.length, excluded: plan.excluded.length },
    created_by: input.actor.userId, expires_at: expiresAt,
  }, { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: true }).select('id');
  if (error) throw error;
  const runId = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!runId) return { error: 'Aperçu déjà utilisé : relancez l’aperçu.', status: 409 };
  return { runId, expiresAt, plan, warnings: previewWarnings(input.request.channels, context) };
}

export interface ConfirmResult {
  queued: number;
  retried: number;
  attempted: number;
  accepted: number;
  deliveryIds: string[];
}

/** Confirmation of a previewed run: same plan or refusal, once. */
export async function confirmBackfill(db: SupabaseClient, input: { tenantId: string; runId: string; actor: AdminAccessContext; now?: Date }): Promise<ConfirmResult | { error: string; status: number }> {
  const now = input.now ?? new Date();
  const { data: run } = await db.from('notification_backfill_runs').select('id, status, mode, channels, order_ids, fingerprint, expires_at, result')
    .eq('id', input.runId).eq('tenant_id', input.tenantId).maybeSingle();
  const row = run as { id: string; status: string; mode: BackfillMode; channels: NotificationChannel[]; order_ids: string[]; fingerprint: string; expires_at: string; result: ConfirmResult | null } | null;
  if (!row) return { error: 'Aperçu introuvable.', status: 404 };
  if (row.status !== 'previewed') return row.result ? row.result : { error: 'Ce rattrapage a déjà été confirmé.', status: 409 };
  if (Date.parse(row.expires_at) < now.getTime()) {
    await db.from('notification_backfill_runs').update({ status: 'expired' }).eq('id', row.id).eq('status', 'previewed');
    return { error: 'Aperçu expiré : relancez l’aperçu.', status: 409 };
  }
  const context = await loadBackfillContext(db, input.tenantId);
  const { plan, fingerprint, orders } = await planFor(db, input.tenantId, row.order_ids, row.channels, row.mode, context);
  if (fingerprint !== row.fingerprint) {
    await db.from('notification_backfill_runs').update({ status: 'expired' }).eq('id', row.id).eq('status', 'previewed');
    return { error: 'Les commandes ou les destinataires ont changé depuis l’aperçu : relancez l’aperçu.', status: 409 };
  }
  // A run killed mid-way (function timeout) must not block the tenant forever:
  // its queued rows stay in the ledger and the scheduler sends them.
  await db.from('notification_backfill_runs').update({ status: 'completed', completed_at: now.toISOString(), result: { interrupted: true } })
    .eq('tenant_id', input.tenantId).eq('status', 'confirmed').lt('confirmed_at', new Date(now.getTime() - 10 * 60_000).toISOString());
  // Single winner: a double click or a second tab gets « already confirmed ».
  const { data: claimed, error: claimError } = await db.from('notification_backfill_runs').update({ status: 'confirmed', confirmed_by: input.actor.userId, confirmed_at: now.toISOString() })
    .eq('id', row.id).eq('status', 'previewed').select('id');
  if (claimError?.code === '23505') return { error: 'Un autre rattrapage est en cours pour cette boutique : réessayez dans un instant.', status: 409 };
  if (claimError) throw claimError;
  if (!(claimed ?? []).length) return { error: 'Ce rattrapage a déjà été confirmé.', status: 409 };

  await recordAuditEvent({
    tenantId: input.tenantId, eventType: 'notifications.backfill.confirmed', actor: input.actor,
    resourceType: 'notification', resourceId: row.id, resourceLabel: `Rattrapage de ${plan.eligibleIds.length} commande(s)`,
    metadata: { mode: row.mode, channels: row.channels, orders: plan.eligibleIds.length, email: plan.messages.email, whatsapp: plan.messages.whatsapp, retries: plan.retries },
    eventKey: `notifications-backfill:${row.id}`,
  });

  const result: ConfirmResult = { queued: 0, retried: 0, attempted: 0, accepted: 0, deliveryIds: [] };
  const deps = defaultDispatchDeps();
  try {
    if (row.mode === 'summary') {
      const byId = new Map(orders.map((order) => [order.id, order]));
      const lines: BacklogOrderLine[] = plan.summaryOrderIds.map((id) => byId.get(id)!).filter(Boolean).map((order) => ({
        orderNumber: order.orderNumber, customer: order.customer, total: order.total, priority: order.priority,
        international: order.international, fresh: order.fresh, frozen: order.frozen,
      }));
      const statuses = new Set(plan.summaryOrderIds.map((id) => byId.get(id)?.status));
      const dispatched = await dispatchTenantNotification({
        tenantId: input.tenantId, eventType: 'order_backlog_summary', entityType: 'notification_backfill_run', entityId: row.id, occurrenceId: 'summary',
        alert: backlogSummaryAlert(lines, statuses.size === 1 && statuses.has('preparing') ? '/admin?status=preparing' : '/admin'),
        audienceTypes: AUDIENCE, channels: row.channels, only: plan.summaryPairs, source: 'backfill', backfillRunId: row.id, sendNow: false,
        facts: { orders: plan.summaryOrderIds.length },
      }, deps);
      result.queued += dispatched.queued;
      result.deliveryIds.push(...dispatched.deliveryIds);
    } else {
      for (const work of plan.orderWork) {
        if (work.missing.length > 0) {
          const loaded = await loadOrderForNotification(db, input.tenantId, work.orderId);
          if (!loaded) continue;
          // A pair previously skipped (channel off at the time) is replaced, never duplicated.
          const { data: event } = await db.from('tenant_notification_events').select('id')
            .match({ tenant_id: input.tenantId, event_type: 'order_created', entity_type: 'order', entity_id: work.orderId, occurrence_id: 'created' }).maybeSingle();
          const eventId = (event as { id: string } | null)?.id;
          if (eventId) {
            await db.from('notification_deliveries').delete().eq('tenant_id', input.tenantId).eq('status', 'skipped')
              .in('idempotency_key', work.missing.map((pair) => deliveryKey(eventId, pair.recipientId, pair.channel)));
          }
          const dispatched = await notifyOrderCreated(input.tenantId, work.orderId, {
            source: 'backfill', backfillRunId: row.id, only: work.missing, sendNow: false, deps, loaded,
          });
          result.queued += dispatched?.queued ?? 0;
          result.deliveryIds.push(...(dispatched?.deliveryIds ?? []));
        }
        for (const retry of work.retry) {
          const { data: current } = await db.from('notification_deliveries').select('attempts, status, payload').eq('id', retry.deliveryId).eq('tenant_id', input.tenantId).maybeSingle();
          const delivery = current as { attempts: number; status: string; payload: unknown } | null;
          if (!delivery || !['failed', 'dead'].includes(delivery.status) || delivery.payload == null) continue;
          const { data: reset } = await db.from('notification_deliveries').update({
            status: 'pending', next_attempt_at: now.toISOString(), max_attempts: Math.min(delivery.attempts + 3, 20), locked_until: null, updated_at: now.toISOString(),
          }).eq('id', retry.deliveryId).eq('status', delivery.status).select('id');
          if ((reset ?? []).length) { result.retried += 1; result.deliveryIds.push(retry.deliveryId); }
        }
      }
    }
    // First batch now, the 5-minute scheduler sends the rest (provider pacing).
    for (const id of result.deliveryIds.slice(0, IMMEDIATE_SENDS)) {
      const outcome = await attemptQueuedDelivery(db, id, routeDelivery);
      if (outcome) { result.attempted += 1; if (outcome.ok) result.accepted += 1; }
    }
  } finally {
    await db.from('notification_backfill_runs').update({ status: 'completed', completed_at: new Date().toISOString(), result })
      .eq('id', row.id).eq('status', 'confirmed');
  }
  return result;
}

export interface RunProgress {
  id: string;
  status: string;
  mode: BackfillMode;
  channels: NotificationChannel[];
  orders: number;
  createdAt: string;
  confirmedAt: string | null;
  createdBy: string | null;
  planned: Record<string, unknown>;
  deliveries: Record<string, number>;
}

/** Recent runs with the live status of their deliveries. */
export async function loadRecentRuns(db: SupabaseClient, tenantId: string, limit = 10): Promise<RunProgress[]> {
  const { data, error } = await db.from('notification_backfill_runs').select('id, status, mode, channels, order_ids, created_at, confirmed_at, planned, result, confirmed_by, created_by')
    .eq('tenant_id', tenantId).in('status', ['confirmed', 'completed']).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  const runs = (data ?? []) as Array<{ id: string; status: string; mode: BackfillMode; channels: NotificationChannel[]; order_ids: string[]; created_at: string; confirmed_at: string | null; planned: Record<string, unknown>; result: ConfirmResult | null; confirmed_by: string | null; created_by: string | null }>;
  const ids = runs.flatMap((run) => run.result?.deliveryIds ?? []);
  const statusById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: rows } = await db.from('notification_deliveries').select('id, status').eq('tenant_id', tenantId).in('id', ids.slice(0, 1000));
    for (const row of (rows ?? []) as Array<{ id: string; status: string }>) statusById.set(row.id, row.status);
  }
  const adminIds = Array.from(new Set(runs.map((run) => run.confirmed_by).filter((id): id is string => !!id)));
  const names = new Map<string, string>();
  if (adminIds.length > 0) {
    const { data: admins } = await db.from('admin_users').select('id, email, first_name, last_name').in('id', adminIds);
    for (const admin of (admins ?? []) as Array<{ id: string; email: string; first_name: string | null; last_name: string | null }>) {
      names.set(admin.id, [admin.first_name, admin.last_name].filter(Boolean).join(' ') || admin.email);
    }
  }
  return runs.map((run) => {
    const deliveries: Record<string, number> = {};
    for (const id of run.result?.deliveryIds ?? []) {
      const status = statusById.get(id) ?? 'purged';
      deliveries[status] = (deliveries[status] ?? 0) + 1;
    }
    return {
      id: run.id, status: run.status, mode: run.mode, channels: run.channels, orders: run.order_ids.length, createdAt: run.created_at,
      confirmedAt: run.confirmed_at, createdBy: run.confirmed_by ? names.get(run.confirmed_by) ?? null : null, planned: run.planned, deliveries,
    };
  });
}

/** « Traiter maintenant » / « Relancer les échecs » for one run: never another run's rows. */
export async function processRun(db: SupabaseClient, tenantId: string, runId: string, options: { retryFailed: boolean }): Promise<{ attempted: number; accepted: number; retried: number } | null> {
  const { data } = await db.from('notification_backfill_runs').select('result').eq('id', runId).eq('tenant_id', tenantId).eq('status', 'completed').maybeSingle();
  const ids = ((data as { result: ConfirmResult | null } | null)?.result?.deliveryIds ?? []).slice(0, 1000);
  if (!data) return null;
  let retried = 0;
  if (options.retryFailed && ids.length > 0) {
    const { data: failed } = await db.from('notification_deliveries').select('id, attempts, status').eq('tenant_id', tenantId).in('id', ids).in('status', ['failed', 'dead']).not('payload', 'is', null);
    for (const row of (failed ?? []) as Array<{ id: string; attempts: number; status: string }>) {
      const { data: reset } = await db.from('notification_deliveries').update({
        status: 'pending', next_attempt_at: new Date().toISOString(), max_attempts: Math.min(row.attempts + 3, 20), locked_until: null, updated_at: new Date().toISOString(),
      }).eq('id', row.id).eq('status', row.status).select('id');
      if ((reset ?? []).length) retried += 1;
    }
  }
  const { data: pending } = await db.from('notification_deliveries').select('id').eq('tenant_id', tenantId).in('id', ids).eq('status', 'pending').limit(IMMEDIATE_SENDS);
  let attempted = 0;
  let accepted = 0;
  for (const row of (pending ?? []) as Array<{ id: string }>) {
    const outcome = await attemptQueuedDelivery(db, row.id, routeDelivery);
    if (outcome) { attempted += 1; if (outcome.ok) accepted += 1; }
  }
  return { attempted, accepted, retried };
}

export { BACKFILL_OPEN_STATUSES };
