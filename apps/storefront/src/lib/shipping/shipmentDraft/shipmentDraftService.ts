import type { Order, ShipmentCreationStatus } from '@lepefy/types';
import type { OrderService } from '@/lib/orders/orderTransitionService';
import { getShippingProvider } from '@/lib/shipping/providers/registry';
import {
  ShipmentDraftError, ShippingProviderError, type ShipmentDraftErrorCode, type ShippingProviderAdapter,
} from '@/lib/shipping/providers/types';
import { buildShipmentDraftInput, type DraftItemRow, type DraftPackagingRow } from './buildDraftInput';
import { readShippingAutomationSettings, type ShippingAutomationSettings } from './settings';
import { shipmentDraftErrorCode } from './shipmentDraftPresentation';

/**
 * Provider shipment draft provisioning (docs/SHIPPING_INTELLIGENCE.md §19).
 *
 * - Events (order created, preparation started) only queue the order
 *   (`pending`) with a cheap compare-and-set: they never call the provider and
 *   never throw, so a provider failure can never fail an order or a picking.
 * - The shipping-sync tick (and the manual admin action) claims the order
 *   `pending|failed → creating` with a compare-and-set on the current status
 *   and attempt counter: only one process can ever call the provider for an
 *   order at a time, and never once a reference is stored.
 * - A provider answer that may follow a created draft (timeout, 5xx other
 *   than 503, 2xx without reference, process killed while `creating`) becomes
 *   `ambiguous` and is never retried automatically (Packlink cannot look up a
 *   shipment by our order reference).
 * - Success stores the reference as a managed shipment; tracking then reuses
 *   syncOrderShipment. A draft is not a shipment: no status change, no email.
 */

export const MAX_AUTOMATIC_ATTEMPTS = 3;
/** A claim older than this was interrupted (crash/timeout of the function). */
export const STALE_CREATING_MS = 10 * 60_000;
/** Minimum delay before an automatic retry of a retryable failure. */
export const RETRY_DELAY_MS = 10 * 60_000;
export const RETRYABLE_DRAFT_ERRORS: readonly ShipmentDraftErrorCode[] = ['provider_unavailable'];
const AMBIGUOUS_DRAFT_ERRORS: readonly ShipmentDraftErrorCode[] = ['provider_timeout', 'ambiguous_creation', 'invalid_provider_response'];
const ACTIVE_ORDER_STATUSES = ['new', 'preparing'];

export type DraftTriggerEvent = 'order_created' | 'preparation_started';
export type DraftIneligibility =
  | 'disabled' | 'provider_unsupported' | 'not_delivery' | 'order_inactive' | 'manual_tracking' | 'existing_reference';

export type DraftCreationOutcome =
  | { outcome: 'created'; reference: string }
  | { outcome: 'skipped'; reason: DraftIneligibility | 'not_queued' | 'requires_confirmation' }
  | { outcome: 'busy' }
  | { outcome: 'failed'; status: 'failed' | 'ambiguous'; code: ShipmentDraftErrorCode };

export interface ShipmentDraftDependencies {
  adapterLookup: (key: string | null | undefined) => ShippingProviderAdapter | null;
  readSettings: (service: OrderService, tenantId: string) => Promise<ShippingAutomationSettings>;
  now: () => Date;
}

export const defaultShipmentDraftDependencies: ShipmentDraftDependencies = {
  adapterLookup: getShippingProvider,
  readSettings: (service, tenantId) => readShippingAutomationSettings(service, tenantId),
  now: () => new Date(),
};

type LogEvent = 'queued' | 'started' | 'created' | 'failed' | 'skipped_existing' | 'ambiguous' | 'linked';
function log(event: LogEvent, order: { id: string; tenant_id: string }, provider: string | null, code?: string) {
  // Ids, provider and result code only: never address, phone, email, key or provider payload.
  const write = event === 'failed' || event === 'ambiguous' ? console.warn : console.info;
  write(`[shipping/draft] ${event} — tenant_id: ${order.tenant_id} — order_id: ${order.id} — provider: ${provider ?? '-'}${code ? ' — code: ' + code : ''}`);
}

/** Pure: whether a tenant/order may get a provider draft (independent of the trigger). */
export function draftIneligibility(order: Order, tenantProvider: string | null | undefined,
  settings: Pick<ShippingAutomationSettings, 'enabled'>, adapter: ShippingProviderAdapter | null): DraftIneligibility | null {
  if (!settings.enabled) return 'disabled';
  if (!adapter?.capabilities.createDraft || !adapter.createShipmentDraft || adapter.key !== tenantProvider) return 'provider_unsupported';
  if (order.fulfillment_type !== 'delivery') return 'not_delivery';
  if (order.shipping_provider_reference) return 'existing_reference';
  if (!ACTIVE_ORDER_STATUSES.includes(order.status)) return 'order_inactive';
  if (order.shipping_tracking_mode === 'manual') return 'manual_tracking';
  return null;
}

/** Pure: whether a triggering event matches the tenant's configured moment. */
export function triggerMatches(settings: Pick<ShippingAutomationSettings, 'enabled' | 'trigger'>, event: DraftTriggerEvent): boolean {
  if (!settings.enabled) return false;
  return (settings.trigger === 'order_created' && event === 'order_created')
    || (settings.trigger === 'preparing' && event === 'preparation_started');
}

async function loadOrder(service: OrderService, tenantId: string, orderId: string): Promise<Order | null> {
  const { data, error } = await service.from('orders').select('*').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new Error('order_unavailable');
  return (data as Order | null) ?? null;
}

async function loadTenant(service: OrderService, tenantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await service.from('tenants').select('*').eq('id', tenantId).maybeSingle();
  if (error) throw new Error('tenant_unavailable');
  return (data as Record<string, unknown> | null) ?? null;
}

function creationStatus(order: Order): ShipmentCreationStatus {
  return order.shipping_creation_status ?? 'not_required';
}

/** CAS on the provisioning state read with the order (null/not_required treated as the same state). */
function matchState<Q extends { eq(key: string, value: unknown): Q; is(key: string, value: null): Q }>(query: Q, order: Order): Q {
  const scoped = query.eq('id', order.id).eq('tenant_id', order.tenant_id).is('shipping_provider_reference', null)
    .eq('shipping_creation_attempts', order.shipping_creation_attempts ?? 0);
  return order.shipping_creation_status == null ? scoped.is('shipping_creation_status', null)
    : scoped.eq('shipping_creation_status', order.shipping_creation_status);
}

async function casUpdate(service: OrderService, order: Order, patch: Record<string, unknown>): Promise<boolean> {
  const query = service.from('orders').update(patch) as unknown as {
    eq(key: string, value: unknown): typeof query; is(key: string, value: null): typeof query;
    select(columns: string): Promise<{ data: unknown[] | null; error: unknown }>;
  };
  const { data, error } = await matchState(query, order).select('id');
  if (error) throw new Error('order_update_failed');
  return (data ?? []).length > 0;
}

/**
 * Event hook (order created / preparation started). Queues the order when the
 * tenant's trigger matches. Never throws and never calls the provider.
 */
export async function requestShipmentDraft(service: OrderService, tenantId: string, orderId: string, event: DraftTriggerEvent,
  deps: ShipmentDraftDependencies = defaultShipmentDraftDependencies): Promise<'queued' | 'skipped'> {
  try {
    const settings = await deps.readSettings(service, tenantId);
    if (!triggerMatches(settings, event)) return 'skipped';
    const [order, tenant] = await Promise.all([loadOrder(service, tenantId, orderId), loadTenant(service, tenantId)]);
    if (!order || !tenant) return 'skipped';
    const provider = typeof tenant.shipping_provider === 'string' ? tenant.shipping_provider : null;
    const reason = draftIneligibility(order, provider, settings, deps.adapterLookup(provider));
    if (reason === 'existing_reference') { log('skipped_existing', order, provider); return 'skipped'; }
    if (reason || creationStatus(order) !== 'not_required') return 'skipped';
    const queued = await casUpdate(service, order, {
      shipping_creation_status: 'pending', shipping_creation_error: null,
      shipping_creation_updated_at: deps.now().toISOString(),
    });
    if (queued) log('queued', order, provider, event);
    return queued ? 'queued' : 'skipped';
  } catch {
    // Missing migration 151, unreadable row…: the order or the picking must still succeed.
    console.error(`[shipping/draft] failed — tenant_id: ${tenantId} — order_id: ${orderId} — code: queue_unavailable`);
    return 'skipped';
  }
}

async function loadDraftData(service: OrderService, order: Order) {
  const itemsResult = await service.from('order_items').select('product_id, name, quantity')
    .eq('order_id', order.id).eq('tenant_id', order.tenant_id);
  if (itemsResult.error) throw new Error('items_unavailable');
  const items = (itemsResult.data ?? []) as DraftItemRow[];
  const productIds = [...new Set(items.map(item => item.product_id).filter((id): id is string => Boolean(id)))];
  const [products, packaging] = await Promise.all([
    productIds.length
      ? service.from('products').select('id, weight_grams').eq('tenant_id', order.tenant_id).in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
    service.from('packaging_surcharges').select('max_pack_kg, box_length_cm, box_width_cm, box_height_cm')
      .eq('tenant_id', order.tenant_id).eq('active', true).maybeSingle(),
  ]);
  if (products.error || packaging.error) throw new Error('draft_data_unavailable');
  const productWeights = new Map(((products.data ?? []) as { id: string; weight_grams: number | null }[])
    .map(product => [product.id, product.weight_grams]));
  return { items, productWeights, packaging: (packaging.data as DraftPackagingRow | null) ?? null };
}

/**
 * Claims and creates the draft for one order.
 * - automatic (tick): only `pending`, or a retryable `failed` under the attempt limit;
 *   an order that is no longer eligible is released back to not_required.
 * - manual (admin): any non-created state; `ambiguous` (and a draft detached
 *   from the order) only with an explicit confirmation that no draft exists.
 */
export async function createShipmentDraftForOrder(service: OrderService, tenantId: string, orderId: string,
  options: { mode: 'automatic' | 'manual'; confirmNoExistingDraft?: boolean },
  deps: ShipmentDraftDependencies = defaultShipmentDraftDependencies): Promise<DraftCreationOutcome> {
  const [settings, order, tenant] = await Promise.all([
    deps.readSettings(service, tenantId), loadOrder(service, tenantId, orderId), loadTenant(service, tenantId),
  ]);
  if (!order || !tenant || order.tenant_id !== tenantId) return { outcome: 'skipped', reason: 'order_inactive' };
  const provider = typeof tenant.shipping_provider === 'string' ? tenant.shipping_provider : null;
  const adapter = deps.adapterLookup(provider);
  const now = deps.now();
  const state = creationStatus(order);

  const reason = draftIneligibility(order, provider, settings, adapter);
  if (reason) {
    if (reason === 'existing_reference') log('skipped_existing', order, provider);
    else if (options.mode === 'automatic' && (state === 'pending' || state === 'failed')) {
      await casUpdate(service, order, { shipping_creation_status: null, shipping_creation_updated_at: now.toISOString() });
    }
    return { outcome: 'skipped', reason };
  }
  if (options.mode === 'automatic') {
    const code = shipmentDraftErrorCode(order.shipping_creation_error);
    const retryable = state === 'failed' && code !== null && RETRYABLE_DRAFT_ERRORS.includes(code)
      && (order.shipping_creation_attempts ?? 0) < MAX_AUTOMATIC_ATTEMPTS;
    if (state !== 'pending' && !retryable) return { outcome: 'skipped', reason: 'not_queued' };
    if (settings.trigger === 'manual') {
      await casUpdate(service, order, { shipping_creation_status: null, shipping_creation_updated_at: now.toISOString() });
      return { outcome: 'skipped', reason: 'disabled' };
    }
  } else {
    if (state === 'creating') return { outcome: 'busy' };
    if ((state === 'ambiguous' || state === 'draft_created') && !options.confirmNoExistingDraft) {
      return { outcome: 'skipped', reason: 'requires_confirmation' };
    }
  }

  const claimed = await casUpdate(service, order, {
    shipping_creation_status: 'creating', shipping_creation_error: null,
    shipping_creation_attempts: (order.shipping_creation_attempts ?? 0) + 1,
    shipping_creation_updated_at: now.toISOString(),
  });
  if (!claimed) return { outcome: 'busy' };
  const claim: Order = { ...order, shipping_creation_status: 'creating', shipping_creation_attempts: (order.shipping_creation_attempts ?? 0) + 1 };
  log('started', order, provider, options.mode);

  const finish = async (status: 'failed' | 'ambiguous', code: ShipmentDraftErrorCode, detail?: string): Promise<DraftCreationOutcome> => {
    await casUpdate(service, claim, {
      shipping_creation_status: status, shipping_creation_error: (detail ? `${code}:${detail}` : code).slice(0, 64),
      shipping_creation_updated_at: deps.now().toISOString(),
    });
    log(status === 'ambiguous' ? 'ambiguous' : 'failed', order, provider, code);
    return { outcome: 'failed', status, code };
  };

  let built: ReturnType<typeof buildShipmentDraftInput>;
  try {
    const data = await loadDraftData(service, order);
    built = buildShipmentDraftInput({ order, ...data, currency: typeof tenant.currency === 'string' ? tenant.currency : 'EUR' });
  } catch {
    // Our own read failed before any provider call: safe to retry.
    return finish('failed', 'provider_unavailable', 'lecture');
  }
  if (!built.ok) return finish('failed', built.code, built.detail);

  let result: Awaited<ReturnType<NonNullable<ShippingProviderAdapter['createShipmentDraft']>>>;
  try {
    result = await adapter!.createShipmentDraft!({ tenantId: order.tenant_id, tenant }, built.input);
    if (result.provider !== adapter!.key || !result.providerReference) throw new ShipmentDraftError('invalid_provider_response');
  } catch (error) {
    // Anything unclassified may have happened after the provider accepted the request.
    const code: ShipmentDraftErrorCode = error instanceof ShipmentDraftError ? error.code : 'ambiguous_creation';
    return finish(AMBIGUOUS_DRAFT_ERRORS.includes(code) ? 'ambiguous' : 'failed', code);
  }

  const saved = await casUpdate(service, claim, {
    shipping_creation_status: 'draft_created', shipping_creation_error: null,
    shipping_creation_updated_at: deps.now().toISOString(), shipping_provider_created_at: result.createdAt,
    shipping_tracking_mode: 'managed', shipping_provider_key: adapter!.key, shipping_provider_reference: result.providerReference,
    shipping_provider_status: result.providerStatus ?? null, shipping_normalized_status: 'pending',
    shipping_provider_synced_at: null, shipping_sync_error: null,
  }).catch(() => false);
  if (!saved) {
    // The provider holds a draft we could not attach (state changed meanwhile): surface it, never recreate.
    await service.from('orders').update({
      shipping_creation_status: 'ambiguous', shipping_creation_error: 'ambiguous_creation:non enregistré',
      shipping_creation_updated_at: deps.now().toISOString(),
    }).eq('id', order.id).eq('tenant_id', order.tenant_id).is('shipping_provider_reference', null);
    console.warn(`[shipping/draft] ambiguous — tenant_id: ${order.tenant_id} — order_id: ${order.id} — provider: ${adapter!.key} — code: not_persisted — reference: ${result.providerReference}`);
    return { outcome: 'failed', status: 'ambiguous', code: 'ambiguous_creation' };
  }
  log('created', order, adapter!.key);
  return { outcome: 'created', reference: result.providerReference };
}

/**
 * Manual reconciliation of an uncertain creation: attaches a draft the team
 * found in the provider back-office, after verifying it with the provider.
 */
export async function linkShipmentDraftReference(service: OrderService, tenantId: string, orderId: string, reference: string,
  deps: ShipmentDraftDependencies = defaultShipmentDraftDependencies): Promise<DraftCreationOutcome> {
  const [settings, order, tenant] = await Promise.all([
    deps.readSettings(service, tenantId), loadOrder(service, tenantId, orderId), loadTenant(service, tenantId),
  ]);
  if (!order || !tenant || order.tenant_id !== tenantId) return { outcome: 'skipped', reason: 'order_inactive' };
  const provider = typeof tenant.shipping_provider === 'string' ? tenant.shipping_provider : null;
  const adapter = deps.adapterLookup(provider);
  const reason = draftIneligibility(order, provider, settings, adapter);
  if (reason) return { outcome: 'skipped', reason };
  if (creationStatus(order) === 'creating') return { outcome: 'busy' };
  const snapshot = await adapter!.resolveShipment({ tenantId: order.tenant_id, tenant }, reference);
  if (snapshot.provider !== adapter!.key) throw new ShippingProviderError('shipment_provider_mismatch');
  const now = deps.now().toISOString();
  const saved = await casUpdate(service, order, {
    shipping_creation_status: 'draft_created', shipping_creation_error: null, shipping_creation_updated_at: now,
    shipping_provider_created_at: now, shipping_tracking_mode: 'managed', shipping_provider_key: adapter!.key,
    shipping_provider_reference: snapshot.providerReference, shipping_provider_status: snapshot.providerStatus,
    shipping_normalized_status: snapshot.normalizedStatus, shipping_provider_synced_at: null, shipping_sync_error: null,
  });
  if (!saved) return { outcome: 'busy' };
  log('linked', order, adapter!.key);
  return { outcome: 'created', reference: snapshot.providerReference };
}

/**
 * Tick step (POST /api/internal/shipping-sync, before tracking sync):
 * 1. interrupted claims (`creating` older than STALE_CREATING_MS) → ambiguous;
 * 2. bounded batch of `pending` + retryable `failed` orders, sequentially.
 * Without migration 151 it reports `unavailable` instead of failing the tick.
 */
export async function runShipmentDraftBatch(service: OrderService,
  deps: ShipmentDraftDependencies = defaultShipmentDraftDependencies,
  { limit = 4, startBefore = Infinity }: { limit?: number; /** Epoch ms: no new provider call starts after it. */ startBefore?: number } = {}) {
  const now = deps.now();
  const staleBefore = new Date(now.getTime() - STALE_CREATING_MS).toISOString();
  const retryBefore = new Date(now.getTime() - RETRY_DELAY_MS).toISOString();
  const [stale, pending, failed] = await Promise.all([
    service.from('orders').select('id, tenant_id').eq('shipping_creation_status', 'creating')
      .is('shipping_provider_reference', null).lt('shipping_creation_updated_at', staleBefore).limit(20),
    service.from('orders').select('id, tenant_id').eq('shipping_creation_status', 'pending')
      .is('shipping_provider_reference', null).order('shipping_creation_updated_at', { ascending: true }).limit(limit),
    service.from('orders').select('id, tenant_id').eq('shipping_creation_status', 'failed')
      .is('shipping_provider_reference', null).in('shipping_creation_error', [...RETRYABLE_DRAFT_ERRORS])
      .lt('shipping_creation_attempts', MAX_AUTOMATIC_ATTEMPTS).lt('shipping_creation_updated_at', retryBefore)
      .order('shipping_creation_updated_at', { ascending: true }).limit(limit),
  ]);
  if (stale.error || pending.error || failed.error) return { unavailable: true, processed: 0, created: 0, failed: 0, ambiguous: 0 };

  let ambiguous = 0;
  for (const row of (stale.data ?? []) as { id: string; tenant_id: string }[]) {
    const { data } = await service.from('orders').update({
      shipping_creation_status: 'ambiguous', shipping_creation_error: 'ambiguous_creation:interrompu',
      shipping_creation_updated_at: now.toISOString(),
    }).eq('id', row.id).eq('tenant_id', row.tenant_id).eq('shipping_creation_status', 'creating')
      .is('shipping_provider_reference', null).lt('shipping_creation_updated_at', staleBefore).select('id');
    if ((data ?? []).length) { ambiguous++; log('ambiguous', row, null, 'interrupted'); }
  }

  const queue = [...(pending.data ?? []), ...(failed.data ?? [])].slice(0, limit) as { id: string; tenant_id: string }[];
  let created = 0;
  let failedCount = 0;
  for (const row of queue) {
    // One creation costs at most ~20 s (warehouse 8 s + draft 12 s): stay inside the tick's maxDuration.
    if (Date.now() >= startBefore) break;
    try {
      const result = await createShipmentDraftForOrder(service, row.tenant_id, row.id, { mode: 'automatic' }, deps);
      if (result.outcome === 'created') created++;
      if (result.outcome === 'failed') { if (result.status === 'ambiguous') ambiguous++; else failedCount++; }
    } catch {
      failedCount++;
      console.error(`[shipping/draft] failed — tenant_id: ${row.tenant_id} — order_id: ${row.id} — code: batch_error`);
    }
  }
  return { unavailable: false, processed: queue.length, created, failed: failedCount, ambiguous };
}
