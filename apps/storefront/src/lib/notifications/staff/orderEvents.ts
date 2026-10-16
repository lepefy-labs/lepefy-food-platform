import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShipmentCreationStatus } from '@lepefy/types';
import { SHIPMENT_CREATION_STATUS_LABELS, shipmentOrderReference } from '@/lib/shipping/shipmentDraft/shipmentDraftPresentation';
import { flagTypeKeys, type NotificationChannel } from '@/lib/notifications/notificationTypes';
import { dispatchTenantNotification, defaultDispatchDeps, type DispatchDeps, type DispatchResult } from './dispatcher';
import {
  coldChainKinds, countryCode, customerShortName, isInternationalDestination, itemCount, newOrderPriority, type StaffPriority,
} from './orderSignals';
import {
  orderAttentionAlert, orderCreatedAlert, orderStockConflictAlert, shipmentAlert,
  type OrderFacts, type RefundState, type ShipmentAlertKind, type ShipmentFacts,
} from './staffMessages';

/**
 * Order notifications of the dispatcher. Every helper reads the order from the
 * database (tenant-scoped), so the message always reflects the stored state,
 * and never throws.
 */

const ORDER_COLUMNS = [
  'id', 'tenant_id', 'full_name', 'total', 'fulfillment_type', 'shipping_address', 'payment_method', 'payment_status', 'status',
  'external_payment_label', 'is_test', 'order_origin', 'created_at', 'updated_at',
  'shipping_provider_key', 'shipping_provider_reference', 'shipping_creation_status', 'tracking_code', 'tracking_carrier',
  'shipping_tracking_url', 'shipping_estimated_delivery_at',
].join(', ');

export interface LoadedOrder {
  facts: OrderFacts;
  priority: StaffPriority;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  isTest: boolean;
  createdAt: string;
  updatedAt: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  stripe: 'Carte bancaire', in_store: 'À régler en boutique', external_link: 'Paiement externe', manual: 'Paiement enregistré par l’équipe',
  cash: 'Espèces', satispay: 'Satispay',
};

export function providerDisplayName(key: string | null | undefined): string | null {
  if (!key) return null;
  return key === 'packlink' ? 'Packlink PRO' : key;
}

interface OrderRow {
  id: string; tenant_id: string; full_name: string | null; total: number; fulfillment_type: 'delivery' | 'pickup';
  shipping_address: { country?: string } | null; payment_method: string | null; payment_status: string; status: string;
  external_payment_label: string | null; is_test: boolean | null; order_origin?: string | null; created_at: string; updated_at: string;
  shipping_provider_key?: string | null; shipping_provider_reference?: string | null; shipping_creation_status?: ShipmentCreationStatus | null;
  tracking_code?: string | null; tracking_carrier?: string | null; shipping_tracking_url?: string | null; shipping_estimated_delivery_at?: string | null;
}

/** Order facts for a message (pure part, unit-tested). */
export function orderFactsFrom(order: OrderRow, lines: ReadonlyArray<{ quantity: number; storage_type?: string | null }>, tenant: { country?: string | null; shipping_provider?: string | null }): { facts: OrderFacts; priority: StaffPriority } {
  const destination = order.fulfillment_type === 'delivery' ? countryCode(order.shipping_address?.country) : null;
  const international = order.fulfillment_type === 'delivery' ? isInternationalDestination(order.shipping_address?.country, tenant.country) : false;
  const { fresh, frozen } = coldChainKinds(lines);
  const providerKey = order.shipping_provider_key ?? tenant.shipping_provider ?? null;
  const provider = order.fulfillment_type === 'delivery' ? providerDisplayName(providerKey) : null;
  const creation = order.shipping_creation_status && order.shipping_creation_status !== 'not_required' ? order.shipping_creation_status : null;
  const shipment: ShipmentFacts | null = provider ? {
    provider,
    providerReference: order.shipping_provider_reference ?? null,
    lepefyReference: shipmentOrderReference(order.id),
    draftStatus: creation ? SHIPMENT_CREATION_STATUS_LABELS[creation] : order.shipping_provider_reference ? null : 'envoi à créer',
    carrier: order.tracking_carrier ?? null,
    trackingCode: order.tracking_code ?? null,
    trackingUrl: order.shipping_tracking_url ?? null,
    estimatedDelivery: order.shipping_estimated_delivery_at ?? null,
  } : null;
  const facts: OrderFacts = {
    orderId: order.id,
    orderNumber: `#${order.id.slice(0, 8).toUpperCase()}`,
    customer: customerShortName(order.full_name),
    total: Number(order.total) || 0,
    items: itemCount(lines),
    fulfillment: order.fulfillment_type,
    paymentLabel: order.payment_method === 'external_link' && order.external_payment_label
      ? order.external_payment_label : PAYMENT_LABELS[order.payment_method ?? ''] ?? null,
    paymentPending: order.payment_method === 'in_store' && order.payment_status !== 'paid',
    destinationCountry: destination,
    international,
    fresh, frozen,
    assisted: order.order_origin === 'assisted',
    shipment,
  };
  return { facts, priority: newOrderPriority({ international, fresh, frozen, fulfillmentType: order.fulfillment_type }) };
}

export async function loadOrderForNotification(db: SupabaseClient, tenantId: string, orderId: string): Promise<LoadedOrder | null> {
  const [orderResult, itemsResult, tenantResult] = await Promise.all([
    db.from('orders').select(ORDER_COLUMNS).eq('id', orderId).eq('tenant_id', tenantId).maybeSingle(),
    db.from('order_items').select('quantity, storage_type').eq('order_id', orderId).eq('tenant_id', tenantId),
    db.from('tenants').select('country, shipping_provider').eq('id', tenantId).maybeSingle(),
  ]);
  if (orderResult.error || !orderResult.data) return null;
  const order = orderResult.data as unknown as OrderRow;
  const lines = (itemsResult.data ?? []) as Array<{ quantity: number; storage_type: string | null }>;
  const tenant = (tenantResult.data ?? {}) as { country?: string | null; shipping_provider?: string | null };
  const { facts, priority } = orderFactsFrom(order, lines, tenant);
  return {
    facts, priority, status: order.status, paymentStatus: order.payment_status, paymentMethod: order.payment_method,
    isTest: order.is_test === true, createdAt: order.created_at, updatedAt: order.updated_at,
  };
}

/** Audience of a new order: its subscribers plus the subscribers of each applicable flag. */
export function orderCreatedAudience(facts: Pick<OrderFacts, 'international' | 'fresh' | 'frozen'>): string[] {
  const flags = flagTypeKeys('order_created').filter((key) =>
    (key === 'order_international' && facts.international === true) || (key === 'order_fresh_products' && (facts.fresh || facts.frozen)));
  return ['order_created', ...flags];
}

async function safely<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch (error) {
    console.error(`[staff-notify] ${label} failed —`, error instanceof Error ? error.message.slice(0, 120) : 'unknown');
    return null;
  }
}

export interface OrderCreatedOptions {
  source?: 'live' | 'backfill';
  backfillRunId?: string | null;
  only?: ReadonlyArray<{ recipientId: string; channel: NotificationChannel }>;
  sendNow?: boolean;
  deps?: DispatchDeps;
  /** Preloaded order (catch-up snapshot verified at confirmation). */
  loaded?: LoadedOrder;
}

/** « Nouvelle commande »: one message per recipient and channel, flags as indicators. */
export async function notifyOrderCreated(tenantId: string, orderId: string, options: OrderCreatedOptions = {}): Promise<DispatchResult | null> {
  return safely('order_created', async () => {
    const deps = options.deps ?? defaultDispatchDeps();
    const loaded = options.loaded ?? await loadOrderForNotification(deps.db, tenantId, orderId);
    if (!loaded) { console.warn('[staff-notify] order_created — order not found —', orderId); return null; }
    if (loaded.isTest && options.source !== 'backfill') { console.info('[staff-notify] order_created — test order skipped —', orderId); return null; }
    return dispatchTenantNotification({
      tenantId, eventType: 'order_created', entityType: 'order', entityId: orderId, occurrenceId: 'created',
      alert: orderCreatedAlert(loaded.facts, loaded.priority), priority: loaded.priority,
      audienceTypes: orderCreatedAudience(loaded.facts),
      facts: { international: loaded.facts.international, fresh: loaded.facts.fresh, frozen: loaded.facts.frozen, fulfillment: loaded.facts.fulfillment },
      source: options.source, backfillRunId: options.backfillRunId, only: options.only, sendNow: options.sendNow,
    }, deps);
  });
}

/**
 * Stock conflict after payment. The email alert keeps its historical sender
 * (orderStockConflictEmail.ts): only WhatsApp goes through the dispatcher, so a
 * recipient never gets two emails for the same conflict.
 */
export async function notifyOrderStockConflict(tenantId: string, orderId: string, refund: RefundState, deps?: DispatchDeps): Promise<DispatchResult | null> {
  return safely('order_stock_conflict', async () => {
    const d = deps ?? defaultDispatchDeps();
    const loaded = await loadOrderForNotification(d.db, tenantId, orderId);
    if (!loaded || loaded.isTest) return null;
    return dispatchTenantNotification({
      tenantId, eventType: 'order_stock_conflict', entityType: 'order', entityId: orderId, occurrenceId: 'conflict',
      alert: orderStockConflictAlert(loaded.facts, { refund }), channels: ['whatsapp'],
    }, d);
  });
}

export async function notifyOrderAttention(tenantId: string, orderId: string, issue: string, occurrenceId: string, deps?: DispatchDeps): Promise<DispatchResult | null> {
  return safely('order_attention_required', async () => {
    const d = deps ?? defaultDispatchDeps();
    const loaded = await loadOrderForNotification(d.db, tenantId, orderId);
    if (!loaded || loaded.isTest) return null;
    return dispatchTenantNotification({
      tenantId, eventType: 'order_attention_required', entityType: 'order', entityId: orderId, occurrenceId,
      alert: orderAttentionAlert(loaded.facts, issue),
    }, d);
  });
}

/** Shipment incident read from the order after the provider/worker wrote it. */
export async function notifyShipmentIssue(tenantId: string, orderId: string, kind: ShipmentAlertKind, issue: string, occurrenceId: string, deps?: DispatchDeps): Promise<DispatchResult | null> {
  return safely(kind, async () => {
    const d = deps ?? defaultDispatchDeps();
    const loaded = await loadOrderForNotification(d.db, tenantId, orderId);
    if (!loaded || loaded.isTest) return null;
    return dispatchTenantNotification({
      tenantId, eventType: kind, entityType: 'order', entityId: orderId, occurrenceId: occurrenceId.slice(0, 120),
      alert: shipmentAlert(kind, loaded.facts, issue),
    }, d);
  });
}
