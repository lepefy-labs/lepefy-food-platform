import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Order } from '@lepefy/types';
import {
  allowedNotifications, closureIssues, closureOf, closureShipmentGuard, closureIdempotencyKey, defaultClosureMessage, isClosableStatus,
} from '../../src/lib/orders/closure/closureRules';
import { closeOrder, OrderClosureError } from '../../src/lib/orders/closure/orderClosureService';
import { OrderWorkflowError, updateWorkflowOrder, type OrderService } from '../../src/lib/orders/orderTransitionService';
import { runOrderTransitionSideEffects } from '../../src/lib/orders/adminOrderWorkflow';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { orderClosureMessageEmail } from '../../src/lib/notifications/customerEmails';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';
import { describeRecentOrder } from '../../src/lib/admin/todayDashboard';

const MIGRATION = readFileSync(resolve(__dirname, '../../../../supabase/migrations/161_order_closure.sql'), 'utf8');
const ORDER_ID = '4a2b91c0-0000-4000-8000-000000000001';

const baseOrder = (patch: Partial<Order> = {}): Order => ({
  id: ORDER_ID, tenant_id: 'tenant-a', status: 'new', fulfillment_type: 'delivery', payment_status: 'paid',
  email: 'awa@example.invalid', full_name: 'Awa Diallo', tracking_code: null, tracking_carrier: null, shipped_at: null,
  picking_started_at: null, picking_completed_at: null, packing_started_at: null, packing_completed_at: null, packing_parcel_count: null,
  cold_chain_packing_checked_at: null, created_at: '2026-10-20T07:00:00Z', updated_at: 'v0', total: 86.4,
  shipping_tracking_mode: null, shipping_provider_reference: null, shipping_provider_key: null,
  ...patch,
} as Order);

function fakeDb(order: Order) {
  const rows: Record<string, Record<string, unknown>[]> = { orders: [{ ...order }], order_items: [] };
  let revision = 0;
  const raw = {
    from(table: string) {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let patch: Record<string, unknown> | undefined;
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query; },
        is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return query; },
        in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return query; },
        update(value: Record<string, unknown>) { patch = value; return query; },
        async maybeSingle() { const result = execute(); return { data: result.data[0] ?? null, error: null }; },
        then(resolveFn: (value: { data: Record<string, unknown>[]; error: null }) => unknown) { return Promise.resolve(execute()).then(resolveFn); },
      };
      function execute() {
        const matches = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (patch) for (const row of matches) Object.assign(row, patch, { updated_at: `v${++revision}` });
        return { data: matches.map((row) => ({ ...row })), error: null };
      }
      return query;
    },
  };
  return { service: raw as unknown as OrderService, order: () => ({ ...rows.orders![0] }) as unknown as Order, rows };
}

const context = { tenantId: 'tenant-a', tenantName: 'Chloe Food', storefrontUrl: 'https://shop.example.invalid', emailBranding: null } as unknown as TenantNotificationContext;

function harness(order: Order) {
  const db = fakeDb(order);
  const sent: Array<{ path: string; payload: Record<string, unknown> }> = [];
  const transitions: Array<{ customerEmail: boolean | undefined; nextStatus: string }> = [];
  const deps = {
    // Real side effects with fake transport: proves which customer emails leave.
    sideEffects: ((args) => {
      transitions.push({ customerEmail: args.customerEmail, nextStatus: args.nextStatus });
      return runOrderTransitionSideEffects(args, {
        processOrderPointsOnDelivery: async () => undefined,
        notifyN8n: async (path, payload) => { sent.push({ path, payload }); return true; },
        getTenantNotificationContext: async () => context,
      });
    }) as typeof runOrderTransitionSideEffects,
    notify: (async (path: string, payload: Record<string, unknown>) => { sent.push({ path, payload }); return true; }) as never,
    getContext: async () => context,
    now: () => new Date('2026-10-20T09:00:00Z'),
  };
  const run = (input: Parameters<typeof closeOrder>[0] extends infer T ? Omit<T & object, 'service' | 'tenantId' | 'orderId' | 'actorId'> : never, tenantId = 'tenant-a') =>
    closeOrder({ ...input, service: db.service, tenantId, orderId: ORDER_ID, actorId: 'admin-1' }, deps);
  return { db, sent, transitions, run, deps };
}

test.beforeEach(() => { process.env.N8N_WEBHOOK_URL = 'https://unused.example.invalid'; });
test.afterEach(() => { delete process.env.N8N_WEBHOOK_URL; });

test.describe('rules', () => {
  test('closable statuses follow the state machine; shipped and delivered never close', () => {
    expect(isClosableStatus('new', 'delivery')).toBe(true);
    expect(isClosableStatus('preparing', 'pickup')).toBe(true);
    expect(isClosableStatus('ready_for_pickup', 'pickup')).toBe(true);
    expect(isClosableStatus('ready_for_pickup', 'delivery')).toBe(false);
    expect(isClosableStatus('shipped', 'delivery')).toBe(false);
    expect(isClosableStatus('cancelled', 'delivery')).toBe(false);
  });

  test('communication choices: no standard « annulée » for an external order, only « none » without email', () => {
    expect(allowedNotifications('handled_externally', true)).toEqual(['none', 'custom']);
    expect(allowedNotifications('duplicate', true)).toEqual(['none', 'standard', 'custom']);
    expect(allowedNotifications('customer_request', false)).toEqual(['none']);
    expect(defaultClosureMessage('handled_externally', { firstName: 'Awa', orderNumber: '#4A2B91C0', tenantName: 'Chloe Food' }))
      .toMatch(/^Bonjour Awa, comme convenu, nous finalisons votre commande #4A2B91C0 directement avec vous/);
    expect(defaultClosureMessage('handled_externally', { firstName: null, orderNumber: '#X', tenantName: 'T' })).not.toContain('annul');
  });

  test('carrier guard: block moving parcels and drafts being created, ask to acknowledge an existing shipment', () => {
    expect(closureShipmentGuard({ status: 'preparing', shipping_normalized_status: 'in_transit' }).blocked).toContain('pris le colis');
    expect(closureShipmentGuard({ status: 'preparing', shipping_creation_status: 'creating' }).blocked).toContain('en cours de création');
    expect(closureShipmentGuard({ status: 'preparing', shipping_creation_status: 'ambiguous' }).blocked).toBeTruthy();
    expect(closureShipmentGuard({ status: 'preparing', shipping_creation_status: 'draft_created' }).shipmentAck).toContain('Packlink PRO');
    expect(closureShipmentGuard({ status: 'preparing', shipping_provider_reference: 'IT2026PRO01', shipping_normalized_status: 'pending' }).shipmentAck).toContain('IT2026PRO01');
    expect(closureShipmentGuard({ status: 'new' })).toEqual({ blocked: null, shipmentAck: null });
  });

  test('validation: reason, message length, note for « other », acknowledgement', () => {
    const order = baseOrder();
    expect(closureIssues(order, { reason: 'other', notification: 'none' })).toContain('Précisez le motif dans la note interne.');
    expect(closureIssues(order, { reason: 'duplicate', notification: 'custom', message: 'trop court' })[0]).toContain('entre 20 et 1000');
    expect(closureIssues(order, { reason: 'handled_externally', notification: 'standard' })[0]).toContain('hors plateforme');
    expect(closureIssues(baseOrder({ email: null }), { reason: 'duplicate', notification: 'standard' })[0]).toContain('pas d’e-mail');
    const shipped = baseOrder({ status: 'preparing', shipping_creation_status: 'draft_created' } as Partial<Order>);
    expect(closureIssues(shipped, { reason: 'duplicate', notification: 'none' })).toContain('Confirmez que l’expédition a été traitée chez le transporteur.');
    expect(closureIssues(shipped, { reason: 'duplicate', notification: 'none', shipmentAcknowledged: true })).toEqual([]);
  });

  test('display: external closures are never shown as cancellations, historical ones are', () => {
    expect(closureOf({ status: 'cancelled', closure_type: 'handled_externally' })).toBe('handled_externally');
    expect(closureOf({ status: 'cancelled', closure_type: null })).toBe('cancelled');
    expect(closureOf({ status: 'preparing' })).toBeNull();
    expect(describeRecentOrder({ id: ORDER_ID, created_at: 'a', updated_at: 'b', status: 'cancelled', payment_status: 'paid', fulfillment_type: 'delivery', full_name: null, total: 1, closure_type: 'handled_externally' }).label).toBe('Traitée hors plateforme');
    expect(closureIdempotencyKey('standard', ORDER_ID)).toBe(`order-cancelled:${ORDER_ID}`);
    expect(closureIdempotencyKey('none', ORDER_ID)).toBeNull();
  });
});

test.describe('service', () => {
  test('silent cancellation: status and decision in one write, no customer email at all', async () => {
    const h = harness(baseOrder());
    const result = await h.run({ reason: 'duplicate', notification: 'none', note: 'Doublon de #1234' });
    expect(result).toMatchObject({ alreadyClosed: false, closureType: 'cancelled', customerNotified: false });
    expect(h.db.order()).toMatchObject({ status: 'cancelled', closure_type: 'cancelled', closure_reason: 'duplicate', closure_notification: 'none', closure_note: 'Doublon de #1234', closed_by: 'admin-1', closed_at: '2026-10-20T09:00:00.000Z', payment_status: 'paid' });
    expect(h.transitions).toEqual([{ customerEmail: false, nextStatus: 'cancelled' }]);
    expect(h.sent).toEqual([]);
  });

  test('standard notification: the historical email with its historical key', async () => {
    const h = harness(baseOrder());
    const result = await h.run({ reason: 'customer_request', notification: 'standard' });
    expect(result.customerNotified).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.payload).toMatchObject({ notificationType: 'order_cancelled', idempotencyKey: `order-cancelled:${ORDER_ID}`, recipients: ['awa@example.invalid'] });
  });

  test('custom message: only the custom email, escaped, with its own key', async () => {
    const h = harness(baseOrder());
    const message = 'Bonjour Awa, nous finalisons votre commande <b>en boutique</b>, à bientôt !';
    const result = await h.run({ reason: 'product_unavailable', notification: 'custom', message });
    expect(result.customerNotified).toBe(true);
    expect(h.sent.map((entry) => entry.payload.notificationType)).toEqual(['order_closure_message']);
    expect(h.sent[0]!.payload.idempotencyKey).toBe(`order-closure-message:${ORDER_ID}`);
    expect(String(h.sent[0]!.payload.html)).toContain('&lt;b&gt;en boutique&lt;/b&gt;');
    expect(h.db.order().closure_message).toBe(message);
  });

  test('handled outside the platform: closed, not a lost sale, payment untouched', async () => {
    const h = harness(baseOrder({ status: 'preparing', payment_status: 'paid' }));
    const result = await h.run({ reason: 'handled_externally', notification: 'custom', message: defaultClosureMessage('handled_externally', { firstName: 'Awa', orderNumber: '#4A2B91C0', tenantName: 'Chloe Food' }) });
    expect(result.closureType).toBe('handled_externally');
    expect(h.db.order()).toMatchObject({ status: 'cancelled', closure_type: 'handled_externally', payment_status: 'paid' });
    await expect(harness(baseOrder()).run({ reason: 'handled_externally', notification: 'standard' })).rejects.toBeInstanceOf(OrderClosureError);
  });

  test('order without email: only « none », nothing is sent', async () => {
    const h = harness(baseOrder({ email: null }));
    await expect(h.run({ reason: 'customer_request', notification: 'custom', message: 'Bonjour, votre commande est annulée comme demandé.' })).rejects.toThrow('pas d’e-mail');
    const result = await h.run({ reason: 'customer_request', notification: 'none' });
    expect(result.customerNotified).toBe(false);
    expect(h.sent).toEqual([]);
  });

  test('Packlink: an existing draft needs the acknowledgement, a moving parcel blocks', async () => {
    const draft = harness(baseOrder({ status: 'preparing', shipping_creation_status: 'draft_created', shipping_provider_reference: 'IT2026PRO1' } as Partial<Order>));
    await expect(draft.run({ reason: 'duplicate', notification: 'none' })).rejects.toThrow('transporteur');
    await draft.run({ reason: 'duplicate', notification: 'none', shipmentAcknowledged: true });
    expect(draft.db.order().shipping_provider_reference).toBe('IT2026PRO1');
    const moving = harness(baseOrder({ status: 'preparing', shipping_normalized_status: 'in_transit' } as Partial<Order>));
    await expect(moving.run({ reason: 'duplicate', notification: 'none', shipmentAcknowledged: true })).rejects.toThrow('pris le colis');
    expect(moving.db.order().status).toBe('preparing');
  });

  test('double click and concurrent requests: one closure, one email', async () => {
    const h = harness(baseOrder());
    const first = await h.run({ reason: 'customer_request', notification: 'standard' });
    const again = await h.run({ reason: 'customer_request', notification: 'standard' });
    expect(first.alreadyClosed).toBe(false);
    expect(again.alreadyClosed).toBe(true);
    expect(h.sent).toHaveLength(1);
    await expect(h.run({ reason: 'duplicate', notification: 'none' })).rejects.toThrow('déjà clôturée');
    // Lost compare-and-set: the winner closed in between, the loser reports the recorded closure.
    const race = harness(baseOrder());
    const racing: typeof updateWorkflowOrder = async (args) => {
      await updateWorkflowOrder({ ...args, sideEffects: async () => undefined });
      throw new OrderWorkflowError('La commande a été modifiée. Actualisez et réessayez.');
    };
    const lost = await closeOrder({ reason: 'duplicate', notification: 'none', service: race.db.service, tenantId: 'tenant-a', orderId: ORDER_ID, actorId: null }, { ...race.deps, update: racing });
    expect(lost.alreadyClosed).toBe(true);
  });

  test('tenant isolation, permissions and the single cancellation path', async () => {
    await expect(harness(baseOrder()).run({ reason: 'duplicate', notification: 'none' }, 'tenant-b')).rejects.toThrow('introuvable');
    expect(permissionForAdminApi(`/api/admin/orders/${ORDER_ID}/close`, 'POST')).toBe('orders.manage');
    const route = readFileSync(resolve(__dirname, '../../src/app/api/admin/orders/[id]/route.ts'), 'utf8');
    expect(route).toContain("if (status === 'cancelled') return NextResponse.json({ error: 'Utilisez « Clôturer ou annuler »");
  });

  test('custom message email keeps the text and the shop identity', () => {
    const rendered = orderClosureMessageEmail(context, { orderNumber: '#4A2B91C0', fullName: 'Awa', orderTrackingLink: null, message: 'Bonjour Awa,\n\nnous finalisons votre commande en boutique.' });
    expect(rendered.subject).toContain('#4A2B91C0');
    expect(rendered.subject).toContain('Chloe Food');
    expect(rendered.html).toContain('nous finalisons votre commande en boutique.');
    expect(rendered.subject).not.toMatch(/annul/i);
  });
});

test.describe('migration 161', () => {
  test('history and statistics: external closures are not commercial cancellations', () => {
    expect(MIGRATION).toContain("count(*) filter (where status = 'cancelled' and coalesce(closure_type, 'cancelled') = 'cancelled') as cancelled_count");
    expect(MIGRATION).toContain("as external_closure_count");
    expect(MIGRATION).toContain("('orders.order.closed', 'orders', 'activity', 'notice', 'business')");
    expect(MIGRATION).not.toMatch(/update public\.orders/i);
    // The audit event never carries the customer message.
    const trigger = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.audit_order_closure_trigger'), MIGRATION.indexOf('revoke all on function public.audit_order_closure_trigger'));
    expect(trigger).not.toContain('closure_message');
  });
});
