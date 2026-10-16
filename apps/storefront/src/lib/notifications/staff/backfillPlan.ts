import type { NotificationChannel } from '@/lib/notifications/notificationTypes';
import type { StaffPriority } from './orderSignals';

/**
 * Pure planning of the « Rattrapage des commandes » (platform owner): which
 * existing orders are still to process, which recipient × channel never got
 * the « Nouvelle commande » notification from Lepefy, and exactly how many
 * messages a confirmation would send. No I/O: the server loads the data
 * (backfill.ts) and the same functions run at preview and at confirmation.
 *
 * « Not notified » only means « no Lepefy notification recorded »: the team
 * may have been told another way, the UI never claims otherwise.
 */

/** Operationally open: paid (or to collect in the shop) and not finished. */
export const BACKFILL_OPEN_STATUSES = ['new', 'preparing', 'ready_for_pickup'] as const;
export const BACKFILL_DEFAULT_STATUSES = ['new', 'preparing'] as const;
export const BACKFILL_MAX_ORDERS = 200;

export type DeliveryState = 'pending' | 'processing' | 'accepted' | 'delivered' | 'failed' | 'dead' | 'skipped' | 'unknown';

export interface BackfillOrder {
  id: string;
  orderNumber: string;
  customer: string | null;
  total: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  isTest: boolean;
  fulfillment: 'delivery' | 'pickup';
  international: boolean | null;
  fresh: boolean;
  frozen: boolean;
  priority: StaffPriority;
  createdAt: string;
  updatedAt: string;
  /** Subscription keys concerned: order_created + applicable flags. */
  audience: string[];
}

export interface RecipientTargets {
  /** recipient id → subscribed type keys, per channel. */
  email: Map<string, Set<string>>;
  whatsapp: Map<string, Set<string>>;
}

export interface ExistingDelivery {
  id: string;
  orderId: string;
  recipientId: string;
  channel: NotificationChannel;
  status: DeliveryState;
}

export interface Pair { recipientId: string; channel: NotificationChannel }

export type BackfillState = 'not_notified' | 'failed' | 'pending' | 'partial' | 'notified' | 'no_target';

export interface OrderClassification {
  state: BackfillState;
  pairs: Pair[];
  /** Pairs with no Lepefy delivery at all. */
  missing: Pair[];
  /** Ledger rows that failed or were abandoned (retried, never duplicated). */
  retry: Array<Pair & { deliveryId: string }>;
  uncertain: number;
  sent: number;
  inFlight: number;
}

const OK: ReadonlySet<DeliveryState> = new Set(['accepted', 'delivered']);
const IN_FLIGHT: ReadonlySet<DeliveryState> = new Set(['pending', 'processing']);
const FAILED: ReadonlySet<DeliveryState> = new Set(['failed', 'dead']);

const STATUS_REASON: Record<string, string> = {
  shipped: 'Déjà expédiée', delivered: 'Livrée ou retirée', cancelled: 'Annulée', stock_conflict: 'Conflit de stock (traité à part)',
};

/** Why an order cannot be caught up (null = eligible). */
export function ineligibilityReason(order: Pick<BackfillOrder, 'status' | 'paymentStatus' | 'paymentMethod' | 'isTest'>): string | null {
  if (order.isTest) return 'Commande de test';
  if (!(BACKFILL_OPEN_STATUSES as readonly string[]).includes(order.status)) return STATUS_REASON[order.status] ?? 'Commande terminée';
  if (order.paymentStatus === 'refunded') return 'Remboursée';
  const paid = order.paymentStatus === 'paid' || (order.paymentMethod === 'in_store' && order.paymentStatus === 'pending');
  return paid ? null : 'Paiement non confirmé';
}

export function pairKey(pair: Pair): string {
  return `${pair.recipientId}:${pair.channel}`;
}

/** Recipient × channel that should receive this order's notification. */
export function orderPairs(order: Pick<BackfillOrder, 'audience'>, targets: RecipientTargets, channels: ReadonlyArray<NotificationChannel>): Pair[] {
  const pairs: Pair[] = [];
  for (const channel of channels) {
    for (const [recipientId, keys] of Array.from(targets[channel].entries())) {
      if (order.audience.some((key) => keys.has(key))) pairs.push({ recipientId, channel });
    }
  }
  return pairs;
}

/**
 * Notification state of one order for the given pairs. `covered` = pairs
 * already reached through an accepted catch-up summary.
 */
export function classifyOrder(pairs: Pair[], existing: ReadonlyArray<ExistingDelivery>, covered: ReadonlySet<string> = new Set()): OrderClassification {
  const byPair = new Map(existing.map((delivery) => [pairKey(delivery), delivery]));
  const result: OrderClassification = { state: 'not_notified', pairs, missing: [], retry: [], uncertain: 0, sent: 0, inFlight: 0 };
  for (const pair of pairs) {
    const key = pairKey(pair);
    const delivery = byPair.get(key);
    if (covered.has(key) || (delivery && OK.has(delivery.status))) { result.sent += 1; continue; }
    if (!delivery || delivery.status === 'skipped') { result.missing.push(pair); continue; }
    if (IN_FLIGHT.has(delivery.status)) { result.inFlight += 1; continue; }
    if (delivery.status === 'unknown') { result.uncertain += 1; continue; }
    if (FAILED.has(delivery.status)) result.retry.push({ ...pair, deliveryId: delivery.id });
  }
  if (pairs.length === 0) result.state = 'no_target';
  else if (result.sent === pairs.length) result.state = 'notified';
  else if (result.inFlight > 0 && result.missing.length === 0 && result.retry.length === 0) result.state = 'pending';
  else if (result.retry.length > 0 && result.sent === 0) result.state = 'failed';
  else if (result.sent > 0 || result.inFlight > 0 || result.uncertain > 0) result.state = 'partial';
  else result.state = 'not_notified';
  return result;
}

export type BackfillMode = 'individual' | 'summary';

export interface BackfillPlan {
  mode: BackfillMode;
  channels: NotificationChannel[];
  selected: number;
  eligibleIds: string[];
  excluded: Array<{ orderId: string; orderNumber: string; reason: string }>;
  /** Messages that a confirmation sends, per channel (new + retried). */
  messages: Record<NotificationChannel, number>;
  newDeliveries: number;
  retries: number;
  alreadyHandled: number;
  recipients: number;
  /** Individual mode: per order work. Summary mode: per recipient × channel. */
  orderWork: Array<{ orderId: string; missing: Pair[]; retry: Array<Pair & { deliveryId: string }> }>;
  summaryPairs: Pair[];
  summaryOrderIds: string[];
}

export function buildBackfillPlan(input: {
  orders: ReadonlyArray<BackfillOrder>;
  /** Ids the platform owner selected that were not found for this tenant. */
  missingIds?: ReadonlyArray<string>;
  targets: RecipientTargets;
  existing: ReadonlyMap<string, ReadonlyArray<ExistingDelivery>>;
  covered: ReadonlyMap<string, ReadonlySet<string>>;
  channels: ReadonlyArray<NotificationChannel>;
  mode: BackfillMode;
}): BackfillPlan {
  const channels = Array.from(new Set(input.channels)).sort() as NotificationChannel[];
  const plan: BackfillPlan = {
    mode: input.mode, channels, selected: input.orders.length + (input.missingIds?.length ?? 0), eligibleIds: [], excluded: [],
    messages: { email: 0, whatsapp: 0 }, newDeliveries: 0, retries: 0, alreadyHandled: 0, recipients: 0,
    orderWork: [], summaryPairs: [], summaryOrderIds: [],
  };
  for (const id of input.missingIds ?? []) plan.excluded.push({ orderId: id, orderNumber: `#${id.slice(0, 8).toUpperCase()}`, reason: 'Commande introuvable' });
  const recipients = new Set<string>();
  const summary = new Map<string, Pair>();
  for (const order of input.orders) {
    const reason = ineligibilityReason(order);
    if (reason) { plan.excluded.push({ orderId: order.id, orderNumber: order.orderNumber, reason }); continue; }
    const pairs = orderPairs(order, input.targets, channels);
    const state = classifyOrder(pairs, input.existing.get(order.id) ?? [], input.covered.get(order.id));
    const work = input.mode === 'summary' ? [...state.missing, ...state.retry] : state.missing;
    const retry = input.mode === 'summary' ? [] : state.retry;
    if (work.length === 0 && retry.length === 0) {
      plan.excluded.push({
        orderId: order.id, orderNumber: order.orderNumber,
        reason: state.state === 'no_target' ? 'Aucun destinataire abonné sur ces canaux'
          : state.uncertain > 0 ? 'Résultat incertain à vérifier (Historique)'
            : state.inFlight > 0 ? 'Notification déjà en file' : 'Déjà notifiée',
      });
      plan.alreadyHandled += 1;
      continue;
    }
    plan.eligibleIds.push(order.id);
    for (const pair of [...work, ...retry]) recipients.add(pair.recipientId);
    if (input.mode === 'summary') {
      plan.summaryOrderIds.push(order.id);
      for (const pair of work) summary.set(pairKey(pair), { recipientId: pair.recipientId, channel: pair.channel });
    } else {
      plan.orderWork.push({ orderId: order.id, missing: state.missing, retry: state.retry });
      for (const pair of state.missing) plan.messages[pair.channel] += 1;
      for (const pair of state.retry) plan.messages[pair.channel] += 1;
      plan.newDeliveries += state.missing.length;
      plan.retries += state.retry.length;
    }
  }
  if (input.mode === 'summary') {
    plan.summaryPairs = Array.from(summary.values()).sort((a, b) => pairKey(a).localeCompare(pairKey(b)));
    for (const pair of plan.summaryPairs) plan.messages[pair.channel] += 1;
    plan.newDeliveries = plan.summaryPairs.length;
  }
  plan.recipients = recipients.size;
  return plan;
}

/** Canonical text hashed into the preview fingerprint (pure; hashed on the server). */
export function planFingerprintSource(orders: ReadonlyArray<Pick<BackfillOrder, 'id' | 'updatedAt' | 'status' | 'paymentStatus'>>, plan: BackfillPlan): string {
  const orderPart = orders.map((order) => `${order.id}|${order.updatedAt}|${order.status}|${order.paymentStatus}`).sort().join(',');
  const workPart = plan.mode === 'summary'
    ? `${plan.summaryOrderIds.slice().sort().join(',')}>${plan.summaryPairs.map(pairKey).join(',')}`
    : plan.orderWork.map((work) => `${work.orderId}:${work.missing.map(pairKey).sort().join('+')}:${work.retry.map((r) => r.deliveryId).sort().join('+')}`).sort().join(',');
  return `v1;${plan.mode};${plan.channels.join('+')};${orderPart};${workPart}`;
}

/** `#A82F19C4` / `a82f` → id range (uuid prefix); null when not a hex prefix. */
export function orderIdRange(q: string | undefined): [string, string] | null {
  const hex = (q ?? '').replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{4,8}$/.test(hex)) return null;
  const low = hex.padEnd(8, '0');
  const high = hex.padEnd(8, 'f');
  return [`${low}-0000-0000-0000-000000000000`, `${high}-ffff-ffff-ffff-ffffffffffff`];
}
