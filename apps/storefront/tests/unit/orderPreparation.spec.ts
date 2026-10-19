import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Order } from '@lepefy/types';
import {
  DIGITAL_PREPARATION, modeOnStart, orderPreparationMode, preparationBlockers, preparationState, preparationStep,
  type OrderPreparationMode,
} from '../../src/lib/orders/preparation/preparationPolicy';
import {
  ORDER_PREPARATION_DEFAULTS, orderPreparationPatchSchema, resolveOrderPreparationSettings, toPreparationMode,
} from '../../src/lib/orders/preparation/settings';
import { completePaperPreparation, startPreparation, withdrawPaperPreparation } from '../../src/lib/orders/preparation/preparationService';
import { buildPreparationSummary } from '../../src/lib/orders/preparation/preparationSummary';
import { OrderWorkflowError, PreparationIncompleteError, updateWorkflowOrder, type OrderService } from '../../src/lib/orders/orderTransitionService';
import { classifyOrderOperation, type OperationalOrder } from '../../src/lib/orders/adminOrderOperations';
import { buildPriorityItems, buildQuickActions, describeRecentOrder } from '../../src/lib/admin/todayDashboard';
import { ORDER_LIST } from '../../src/lib/orders/orderListParams';
import { ORDER_VIEWS } from '../../src/lib/orders/loadOrderWorkQueue';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { ORDER_DOCUMENT_ROUTE_KINDS } from '../../src/lib/orders/documents/renderOrderDocuments';
import type { DocumentItemRow, DocumentOrderRow } from '../../src/lib/orders/documents/viewModels';
import { isMissingPreparationColumn, withoutPreparationColumns } from '../../src/lib/orders/preparation/compat';

const MIGRATION = readFileSync(resolve(__dirname, '../../../../supabase/migrations/160_order_preparation_modes.sql'), 'utf8');
const PAPER: OrderPreparationMode = { picking: 'paper', cold_chain_packing: 'paper' };
const NONE: OrderPreparationMode = { picking: 'none', cold_chain_packing: 'none' };
const ORDER_ID = '3f2a91c0-0000-4000-8000-000000000001';
const OTHER_ID = '3f2a91c0-0000-4000-8000-000000000002';
const thresholds = { prepareHours: 24, pickupHours: 48, trackingStaleHours: 72 };
const now = new Date('2026-10-20T10:00:00Z');

const dry = { storage_type: 'dry', picked_at: null, cold_chain_checked_at: null };
const frozen = { storage_type: 'frozen', picked_at: null, cold_chain_checked_at: null };

const baseOrder = (patch: Partial<Order> = {}): Order => ({
  id: ORDER_ID, tenant_id: 'tenant-a', status: 'preparing', fulfillment_type: 'delivery', payment_status: 'paid',
  email: 'client@example.invalid', full_name: 'Awa Test', tracking_code: null, tracking_carrier: null, shipped_at: null,
  picking_started_at: '2026-10-20T08:00:00Z', picking_completed_at: null, packing_started_at: null, packing_completed_at: null,
  packing_parcel_count: null, cold_chain_packing_checked_at: null, created_at: '2026-10-20T07:00:00Z', updated_at: 'v0',
  shipping_tracking_mode: null, shipping_provider_reference: null, shipping_provider_key: null, preparation_mode: null,
  ...patch,
} as Order);

/** PostgREST-like fake: eq / in / is filters, update with compare-and-set, maybeSingle. */
function fakeDb(orders: Order[], items: Array<Record<string, unknown>>) {
  const rows: Record<string, Record<string, unknown>[]> = {
    orders: orders.map((order) => ({ ...order })),
    order_items: items.map((item) => ({ tenant_id: 'tenant-a', order_id: ORDER_ID, ...item })),
    platform_features: [{ key: 'order_preparation' }],
    tenant_feature_settings: [],
  };
  let revision = 0;
  const raw = {
    from(table: string) {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let patch: Record<string, unknown> | undefined;
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query; },
        in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return query; },
        is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return query; },
        order() { return query; },
        limit() { return query; },
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
  return { service: raw as unknown as OrderService, rows, order: (id = ORDER_ID) => ({ ...rows.orders!.find((row) => row.id === id) }) as unknown as Order };
}

const quiet = { sideEffects: async () => undefined, onPreparationStarted: async () => undefined } as const;
const update = (mode: OrderPreparationMode | null = null): typeof updateWorkflowOrder => (args) =>
  updateWorkflowOrder({ ...args, ...quiet, resolvePreparationMode: async () => mode });

// ─── Settings ───────────────────────────────────────────────────────────────

test.describe('settings', () => {
  test('default is the historical digital mode for every tenant; both settings are independent', () => {
    expect(resolveOrderPreparationSettings(null).config).toEqual(ORDER_PREPARATION_DEFAULTS);
    expect(toPreparationMode(ORDER_PREPARATION_DEFAULTS)).toEqual(DIGITAL_PREPARATION);
    const mixed = resolveOrderPreparationSettings({ enabled: true, config: { version: 1, picking_mode: 'paper', cold_chain_packing_mode: 'digital' } });
    expect(toPreparationMode(mixed.config)).toEqual({ picking: 'paper', cold_chain_packing: 'digital' });
  });

  test('an invalid stored row never relaxes a control; patch schema refuses unknown keys and values', () => {
    const invalid = resolveOrderPreparationSettings({ enabled: true, config: { picking_mode: 'skip' } });
    expect(invalid.status).toBe('invalid');
    expect(invalid.config).toEqual(ORDER_PREPARATION_DEFAULTS);
    expect(orderPreparationPatchSchema.safeParse({ config: { picking_mode: 'paper' } }).success).toBe(true);
    expect(orderPreparationPatchSchema.safeParse({ config: { picking_mode: 'automatic' } }).success).toBe(false);
    expect(orderPreparationPatchSchema.safeParse({ config: { picking_mode: 'paper', tenant_id: 'x' } }).success).toBe(false);
  });

  test('the SQL CHECK mirrors the TS values; no tenant row is created by the migration', () => {
    expect(MIGRATION).toContain("p_config->>'picking_mode' in ('digital', 'paper', 'none')");
    expect(MIGRATION).toContain("p_config->>'cold_chain_packing_mode' in ('digital', 'paper', 'none')");
    expect(MIGRATION).not.toMatch(/insert into public\.tenant_feature_settings/i);
    expect(MIGRATION).not.toMatch(/update public\.orders/i);
  });

  test('settings API is tenant_settings.view / manage; preparation writes need orders.manage', () => {
    expect(permissionForAdminApi('/api/admin/order-preparation/settings', 'GET')).toBe('tenant_settings.view');
    expect(permissionForAdminApi('/api/admin/order-preparation/settings', 'PATCH')).toBe('tenant_settings.manage');
    expect(permissionForAdminApi('/api/admin/orders/preparation/start', 'POST')).toBe('orders.manage');
    expect(permissionForAdminApi(`/api/admin/orders/${ORDER_ID}/preparation`, 'POST')).toBe('orders.manage');
    expect(permissionForAdminApi(`/api/admin/orders/${ORDER_ID}/preparation`, 'DELETE')).toBe('orders.manage');
    expect(permissionForAdminApi('/api/admin/orders/documents/preparation-summary', 'GET')).toBe('orders.view');
    expect(ORDER_DOCUMENT_ROUTE_KINDS['preparation-summary']).toBe('preparation_summary');
  });
});

// ─── Policy ─────────────────────────────────────────────────────────────────

test.describe('preparation policy', () => {
  test('no snapshot or an unreadable one is digital; legacy rules are unchanged', () => {
    expect(orderPreparationMode({ preparation_mode: null })).toEqual(DIGITAL_PREPARATION);
    expect(orderPreparationMode({ preparation_mode: { picking: 'skip' } })).toEqual(DIGITAL_PREPARATION);
    const order = baseOrder({ packing_completed_at: 'x', packing_parcel_count: 1, cold_chain_packing_checked_at: 'x' });
    expect(preparationBlockers(order, [{ ...dry }, { ...frozen }], true)[0]).toContain('Préparation incomplète : 2 lignes non prélevées · 1 contrôle froid manquant');
    expect(preparationBlockers(order, [{ ...dry, picked_at: 'x' }, { ...frozen, picked_at: 'x', cold_chain_checked_at: 'x' }], true)).toEqual([]);
    expect(preparationBlockers(order, [], true)).toEqual(['La commande ne contient aucun article à préparer.']);
  });

  test('paper: line ticks are not required, an explicit declaration is; it never fills digital columns', () => {
    const order = baseOrder({ preparation_mode: PAPER, packing_parcel_count: 2 });
    expect(preparationBlockers(order, [{ ...dry }], false)).toEqual(['Préparation papier à confirmer : utilisez « Préparation terminée ».']);
    const declared = { ...order, paper_preparation_completed_at: 'x' };
    expect(preparationBlockers(declared, [{ ...dry }], true)).toEqual([]);
    const state = preparationState(declared, [{ ...dry }]);
    expect(state.pickingDone).toBe(true);
    expect(state.lines?.picked).toBe(0);
  });

  test('frozen products stay mandatory: paper cold packing needs its declaration, parcels are never invented', () => {
    const order = baseOrder({ preparation_mode: PAPER, paper_preparation_completed_at: 'x' });
    expect(preparationBlockers(order, [{ ...frozen }], true)).toEqual(['Nombre de colis à renseigner avant l’expédition.']);
    const parcels = { ...order, packing_parcel_count: 1 };
    expect(preparationBlockers(parcels, [{ ...frozen }], true)).toEqual(['Emballage froid à confirmer (déclaration papier) avant l’expédition.']);
    expect(preparationBlockers({ ...parcels, cold_chain_packing_declared_at: 'x' }, [{ ...frozen }], true)).toEqual([]);
    // Paper picking + digital cold check: the digital check is still required.
    const mixed = { ...parcels, preparation_mode: { picking: 'paper', cold_chain_packing: 'digital' }, cold_chain_packing_declared_at: 'x' };
    expect(preparationBlockers(mixed, [{ ...frozen }], true)[0]).toContain('Emballage incomplet');
    // A pickup has no cold packing step.
    expect(preparationBlockers({ ...order, fulfillment_type: 'pickup' }, [{ ...frozen }], false)).toEqual([]);
  });

  test('« sans confirmation »: nothing to tick, still a parcel count, and the transition is flagged unverified', () => {
    const order = baseOrder({ preparation_mode: NONE });
    expect(preparationBlockers(order, [{ ...frozen }], true)).toEqual(['Nombre de colis à renseigner avant l’expédition.']);
    const state = preparationState({ ...order, packing_parcel_count: 1 }, [{ ...frozen }]);
    expect(state.readyForFinal).toBe(true);
    expect(state.unverified).toBe(true);
    expect(preparationState(baseOrder({ preparation_mode: { picking: 'paper', cold_chain_packing: 'none' } }), [{ ...dry }]).unverified).toBe(false);
  });

  test('steps: printing alone never makes an order ready', () => {
    expect(preparationStep(baseOrder({ status: 'new' }), PAPER)?.key).toBe('to_print');
    expect(preparationStep(baseOrder({ status: 'new' }), DIGITAL_PREPARATION)?.key).toBe('to_prepare');
    const printed = baseOrder({ preparation_mode: PAPER, picking_list_printed_at: 'x', paper_preparation_started_at: 'x' });
    expect(preparationStep(printed)?.key).toBe('printed');
    expect(preparationStep({ ...printed, paper_preparation_completed_at: 'x' })?.key).toBe('prepared');
    expect(preparationStep({ ...printed, paper_preparation_completed_at: 'x', packing_parcel_count: 1 })?.label).toBe('Prêt à expédier');
    expect(preparationStep({ ...printed, fulfillment_type: 'pickup', paper_preparation_completed_at: 'x' })?.label).toBe('Prête au retrait');
    expect(preparationStep(baseOrder({ status: 'shipped' }))).toBeNull();
  });

  test('mode change while working: started orders keep their snapshot, untouched ones adopt the new mode', () => {
    expect(modeOnStart(baseOrder({ status: 'new' }), [], PAPER)).toEqual(PAPER);
    expect(modeOnStart(baseOrder({ preparation_mode: DIGITAL_PREPARATION }), [], PAPER)).toBeNull();
    expect(modeOnStart(baseOrder(), [{ ...dry, picked_at: 'x' }], PAPER)).toBeNull();
    expect(modeOnStart(baseOrder({ packing_started_at: 'x' } as Partial<Order>), [{ ...dry }], PAPER)).toBeNull();
    expect(modeOnStart(baseOrder(), [{ ...dry }], PAPER)).toEqual(PAPER);
  });
});

// ─── Transitions ────────────────────────────────────────────────────────────

test.describe('state machine', () => {
  test('new → preparing snapshots the tenant mode once; a setting change later never rewrites it', async () => {
    const db = fakeDb([baseOrder({ status: 'new', picking_started_at: null })], [{ ...dry }]);
    await updateWorkflowOrder({ service: db.service, order: db.order(), nextStatus: 'preparing', ...quiet, resolvePreparationMode: async () => PAPER });
    expect(db.order().preparation_mode).toEqual(PAPER);
    await updateWorkflowOrder({ service: db.service, order: db.order(), patch: { notes: 'x' }, ...quiet, resolvePreparationMode: async () => DIGITAL_PREPARATION });
    expect(db.order().preparation_mode).toEqual(PAPER);
    // Migration absent (null): no snapshot, the order keeps the digital rules.
    const legacy = fakeDb([baseOrder({ status: 'new', picking_started_at: null })], [{ ...dry }]);
    await updateWorkflowOrder({ service: legacy.service, order: legacy.order(), nextStatus: 'preparing', ...quiet, resolvePreparationMode: async () => null });
    expect(legacy.order().preparation_mode ?? null).toBeNull();
  });

  test('paper order cannot ship before « Préparation terminée », can after; digital ticks stay empty', async () => {
    const db = fakeDb([baseOrder({ preparation_mode: PAPER, packing_parcel_count: 1 })], [{ ...dry }]);
    await expect(updateWorkflowOrder({ service: db.service, order: db.order(), nextStatus: 'shipped', patch: { tracking_code: 'TRK1' }, ...quiet })).rejects.toBeInstanceOf(PreparationIncompleteError);
    db.rows.orders![0]!.paper_preparation_completed_at = '2026-10-20T09:00:00Z';
    const saved = await updateWorkflowOrder({ service: db.service, order: db.order(), nextStatus: 'shipped', patch: { tracking_code: 'TRK1' }, ...quiet });
    expect(saved.status).toBe('shipped');
    expect(saved.picking_completed_at).toBeNull();
    expect(saved.preparation_unverified_at ?? null).toBeNull();
    expect(db.rows.order_items![0]!.picked_at).toBeNull();
  });

  test('« sans confirmation »: shipping still needs tracking, then stamps preparation_unverified_at', async () => {
    const db = fakeDb([baseOrder({ preparation_mode: NONE, packing_parcel_count: 1 })], [{ ...frozen }]);
    await expect(updateWorkflowOrder({ service: db.service, order: db.order(), nextStatus: 'shipped', ...quiet })).rejects.toBeInstanceOf(OrderWorkflowError);
    const saved = await updateWorkflowOrder({ service: db.service, order: db.order(), nextStatus: 'shipped', patch: { tracking_code: 'TRK1' }, ...quiet });
    expect(saved.preparation_unverified_at).toBeTruthy();
    expect(saved.cold_chain_packing_checked_at).toBeNull();
  });

  test('a digital order keeps every historical block (no paper bypass for other tenants)', async () => {
    const db = fakeDb([baseOrder({ packing_parcel_count: 1, packing_completed_at: 'x', paper_preparation_completed_at: 'x' })], [{ ...dry }]);
    await expect(updateWorkflowOrder({ service: db.service, order: db.order(), nextStatus: 'shipped', patch: { tracking_code: 'T' }, ...quiet })).rejects.toBeInstanceOf(PreparationIncompleteError);
  });
});

// ─── Paper flow ─────────────────────────────────────────────────────────────

test.describe('paper flow', () => {
  test('« Imprimer et démarrer »: starts paid orders, skips unpaid / stock conflict, idempotent on retry', async () => {
    const db = fakeDb([
      baseOrder({ status: 'new', picking_started_at: null }),
      baseOrder({ id: OTHER_ID, status: 'new', payment_status: 'pending' }),
    ], [{ ...dry }]);
    db.rows.orders!.push({ ...baseOrder({ id: '3f2a91c0-0000-4000-8000-000000000003', status: 'stock_conflict' }) });
    const first = await startPreparation({ service: db.service, tenantId: 'tenant-a', orderIds: [ORDER_ID, OTHER_ID, '3f2a91c0-0000-4000-8000-000000000003'], actorId: 'admin-1', tenantMode: PAPER, update: update(PAPER), now: () => now });
    expect(first.started).toEqual([ORDER_ID]);
    expect(first.skipped).toEqual([{ id: OTHER_ID, reason: 'payment' }, { id: '3f2a91c0-0000-4000-8000-000000000003', reason: 'stock_conflict' }]);
    const started = db.order();
    expect(started).toMatchObject({ status: 'preparing', preparation_mode: PAPER, picking_list_printed_at: now.toISOString(), paper_preparation_started_by: 'admin-1' });
    expect(started.paper_preparation_completed_at ?? null).toBeNull();
    const again = await startPreparation({ service: db.service, tenantId: 'tenant-a', orderIds: [ORDER_ID], actorId: 'admin-2', tenantMode: PAPER, update: update(PAPER), now: () => new Date('2026-10-20T11:00:00Z') });
    expect(again).toEqual({ ready: [ORDER_ID], started: [], skipped: [] });
    expect(db.order().picking_list_printed_at).toBe(now.toISOString());
    expect(db.order().paper_preparation_started_by).toBe('admin-1');
  });

  test('concurrent retry: a lost compare-and-set reports the order as ready, never twice started', async () => {
    const db = fakeDb([baseOrder({ status: 'new', picking_started_at: null })], [{ ...dry }]);
    const racing: typeof updateWorkflowOrder = async (args) => {
      await updateWorkflowOrder({ ...args, ...quiet, resolvePreparationMode: async () => PAPER }); // the other click wins
      throw new OrderWorkflowError('La commande a été modifiée. Actualisez et réessayez.');
    };
    const result = await startPreparation({ service: db.service, tenantId: 'tenant-a', orderIds: [ORDER_ID], actorId: null, tenantMode: PAPER, update: racing });
    expect(result.ready).toEqual([ORDER_ID]);
    expect(result.started).toEqual([]);
  });

  test('« Préparation terminée » requires the declaration, the parcel count and the cold declaration', async () => {
    const order = baseOrder({ preparation_mode: PAPER, picking_list_printed_at: 'x' });
    const db = fakeDb([order], [{ ...dry }, { ...frozen }]);
    const base = { service: db.service, tenantId: 'tenant-a', orderId: ORDER_ID, actorId: 'admin-1', now: () => now };
    await expect(completePaperPreparation({ ...base, allPrepared: false, parcelCount: 1, coldDeclared: true })).rejects.toThrow('Confirmez que tous les articles');
    await expect(completePaperPreparation({ ...base, allPrepared: true, parcelCount: null, coldDeclared: true })).rejects.toThrow('nombre de colis');
    await expect(completePaperPreparation({ ...base, allPrepared: true, parcelCount: 2, coldDeclared: false })).rejects.toThrow('frais et surgelés');
    const done = await completePaperPreparation({ ...base, allPrepared: true, parcelCount: 2, coldDeclared: true });
    expect(done).toMatchObject({ paper_preparation_completed_by: 'admin-1', packing_parcel_count: 2, cold_chain_packing_declared_at: now.toISOString() });
    expect(done.cold_chain_packing_checked_at).toBeNull();
    expect(done.packing_completed_at).toBeNull();
    // Retry: same declaration, nothing rewritten.
    const retry = await completePaperPreparation({ ...base, actorId: 'admin-2', allPrepared: true, parcelCount: 5, coldDeclared: true });
    expect(retry.paper_preparation_completed_by).toBe('admin-1');
    expect(retry.packing_parcel_count).toBe(2);
    const withdrawn = await withdrawPaperPreparation({ service: db.service, tenantId: 'tenant-a', orderId: ORDER_ID });
    expect(withdrawn.paper_preparation_completed_at).toBeNull();
    expect(withdrawn.packing_parcel_count).toBe(2);
  });

  test('paper completion is refused for digital orders, unpaid orders and other tenants', async () => {
    const digital = fakeDb([baseOrder()], [{ ...dry }]);
    await expect(completePaperPreparation({ service: digital.service, tenantId: 'tenant-a', orderId: ORDER_ID, actorId: null, allPrepared: true, parcelCount: 1 })).rejects.toThrow('checklist');
    const unpaid = fakeDb([baseOrder({ preparation_mode: PAPER, payment_status: 'pending' })], [{ ...dry }]);
    await expect(completePaperPreparation({ service: unpaid.service, tenantId: 'tenant-a', orderId: ORDER_ID, actorId: null, allPrepared: true, parcelCount: 1 })).rejects.toThrow('Paiement');
    const other = fakeDb([baseOrder({ preparation_mode: PAPER })], [{ ...dry }]);
    await expect(completePaperPreparation({ service: other.service, tenantId: 'tenant-b', orderId: ORDER_ID, actorId: null, allPrepared: true, parcelCount: 1 })).rejects.toThrow('introuvable');
  });
});

// ─── Classifier (dashboard, list, KPIs) ─────────────────────────────────────

test.describe('classifier', () => {
  const op = (order: Partial<OperationalOrder>, tenantMode: OrderPreparationMode = DIGITAL_PREPARATION) =>
    classifyOrderOperation({ ...(baseOrder() as unknown as OperationalOrder), order_items: [{ storage_type: 'frozen' }], ...order, tenantPreparationMode: tenantMode }, thresholds, now);

  test('paper orders are not « Préparation incomplète » nor « Chaîne du froid » for a missing digital tick', () => {
    const digital = op({});
    expect(digital.flags.has('picking_incomplete')).toBe(true);
    expect(digital.flags.has('cold_chain')).toBe(true);
    const paper = op({ preparation_mode: PAPER, picking_list_printed_at: 'x', paper_preparation_started_at: 'x' });
    expect(paper.flags.has('picking_incomplete')).toBe(false);
    expect(paper.flags.has('cold_chain')).toBe(false);
    expect(paper.flags.has('paper_in_progress')).toBe(true);
    expect(paper.action.label).toBe('Terminer la préparation');
    expect(op({ status: 'new' }, PAPER).flags.has('cold_chain')).toBe(false);
  });

  test('real problems stay visible in paper mode: payment, stock conflict', () => {
    expect(op({ preparation_mode: PAPER, payment_status: 'pending' }).flags.has('payment_unverified')).toBe(true);
    expect(op({ preparation_mode: PAPER, payment_status: 'pending' }).flags.has('to_prepare')).toBe(false);
    expect(op({ preparation_mode: PAPER, status: 'stock_conflict' }).flags.has('stock_conflict')).toBe(true);
  });

  test('to print / to prepare / ready to ship follow the mode', () => {
    expect(op({ status: 'new' }, PAPER).flags.has('to_print')).toBe(true);
    expect(op({ status: 'new' }, PAPER).action.label).toBe('Imprimer et démarrer');
    expect(op({ status: 'new' }).flags.has('to_print')).toBe(false);
    const declared = op({ preparation_mode: PAPER, paper_preparation_completed_at: 'x', packing_parcel_count: 2, cold_chain_packing_declared_at: 'x' });
    expect(declared.flags.has('to_ship')).toBe(true);
    expect(declared.flags.has('to_prepare')).toBe(false);
    expect(declared.step?.key).toBe('ready');
  });
});

// ─── Preparation session ────────────────────────────────────────────────────

test.describe('preparation session', () => {
  const order = (id: string, patch: Partial<DocumentOrderRow> = {}): DocumentOrderRow => ({
    id, created_at: '2026-10-20T07:00:00Z', status: 'preparing', fulfillment_type: 'delivery', full_name: 'Client',
    shipping_address: { postal_code: '75011', city: 'Paris', country: 'FR' }, shipping_details: null, shipping_cost: 0, total: 10, ...patch,
  });
  const item = (orderId: string, name: string, patch: Partial<DocumentItemRow> = {}): DocumentItemRow => ({
    order_id: orderId, product_id: `p-${name}`, name, name_alt: null, price: 1, quantity: 1, subtotal: 1, storage_type: 'dry', warehouse_location: null, ...patch,
  });

  test('totals per article keep the split by order; dry → fresh → frozen; no location last in its group', () => {
    const summary = buildPreparationSummary([
      { order: order(ORDER_ID), items: [item(ORDER_ID, 'Attiéké', { quantity: 3, warehouse_location: 'A-03' }), item(ORDER_ID, 'Tilapia', { storage_type: 'frozen', warehouse_location: 'S-02', quantity: 2 }), item(ORDER_ID, 'Huile', { quantity: 1 })] },
      { order: order(OTHER_ID, { fulfillment_type: 'pickup' }), items: [item(OTHER_ID, 'Attiéké', { quantity: 2, warehouse_location: 'A-03' }), item(OTHER_ID, 'Feuilles', { storage_type: 'fresh', warehouse_location: 'F-01', quantity: 2 })] },
    ]);
    expect(summary.orderCount).toBe(2);
    expect(summary.totalUnits).toBe(10);
    expect(summary.groups.map((group) => group.storage)).toEqual(['dry', 'fresh', 'frozen']);
    expect(summary.groups[0]!.lines.map((line) => line.name)).toEqual(['Attiéké', 'Huile']);
    const attieke = summary.groups[0]!.lines[0]!;
    expect(attieke.total).toBe(5);
    expect(attieke.perOrder.map((entry) => [entry.ref, entry.quantity])).toEqual([['3F2A91C0', 3], ['3F2A91C0', 2]]);
    expect(attieke.perOrder.map((entry) => entry.orderId)).toEqual([ORDER_ID, OTHER_ID]);
  });

  test('cancelled orders are left out; catalogue checks are facts only; digital picks only when tracked', () => {
    const summary = buildPreparationSummary([
      { order: order(ORDER_ID), items: [{ ...item(ORDER_ID, 'A'), picked_at: 'x' }, item(ORDER_ID, 'B'), item(ORDER_ID, 'C', { product_id: null })], trackDigital: true },
      { order: order(OTHER_ID, { status: 'cancelled' }), items: [item(OTHER_ID, 'A', { quantity: 9 })] },
    ], new Map([['p-A', { stock: -2, active: true }], ['p-B', { stock: 4, active: false }]]));
    const lines = summary.groups[0]!.lines;
    expect(summary.orderCount).toBe(1);
    expect(lines.find((line) => line.name === 'A')).toMatchObject({ total: 1, check: 'Stock catalogue négatif (-2)' });
    expect(lines.find((line) => line.name === 'B')?.check).toBe('Produit désactivé dans le catalogue');
    expect(lines.find((line) => line.name === 'C')?.check).toBeNull();
    expect(lines.find((line) => line.name === 'A')?.perOrder[0]?.picked).toBe(true);
    const untracked = buildPreparationSummary([{ order: order(ORDER_ID), items: [{ ...item(ORDER_ID, 'A'), picked_at: 'x' }] }]);
    expect(untracked.groups[0]!.lines[0]!.perOrder[0]!.picked).toBeNull();
  });
});

// ─── Dashboard and URLs ─────────────────────────────────────────────────────

test.describe('dashboard « Aujourd’hui »', () => {
  test('priorities: only real actions, most severe first; a positive empty state otherwise', () => {
    expect(buildPriorityItems({ kpis: {}, pendingLinkPayments: 0, preordersToVerify: 0 })).toEqual([]);
    const items = buildPriorityItems({ kpis: { incidents: 1, late_preparation: 2, payment_unverified: 1, stock_conflict: 0 }, pendingLinkPayments: 1, preordersToVerify: 0 });
    expect(items.map((item) => item.key)).toEqual(['incidents', 'payment_unverified', 'link_payments', 'late_preparation']);
    expect(items.every((item) => item.href.startsWith('/admin/orders'))).toBe(true);
    // Paper-mode bookkeeping is never a priority.
    expect(buildPriorityItems({ kpis: { paper_in_progress: 4, picking_incomplete: 0 }, pendingLinkPayments: 0, preordersToVerify: 0 })).toEqual([]);
  });

  test('quick actions follow permissions and the mode', () => {
    const viewer = buildQuickActions({ kpis: { to_prepare: 3, to_print: 2 }, mode: PAPER, canManage: false, paymentsToVerify: 0 });
    expect(viewer.map((action) => action.key)).toEqual(['prepare', 'print', 'ship', 'payments']);
    expect(viewer.find((action) => action.key === 'print')?.href).toBe('/admin/orders?view=to_print');
    const manager = buildQuickActions({ kpis: {}, mode: DIGITAL_PREPARATION, canManage: true, paymentsToVerify: 0 });
    expect(manager.map((action) => action.key)).toContain('new_order');
    expect(manager.find((action) => action.key === 'print')?.href).toBe('/admin/orders/preparation');
  });

  test('recent activity wording comes from the current state only', () => {
    const row = { id: ORDER_ID, created_at: '2026-10-20T09:00:00Z', updated_at: '2026-10-20T09:00:30Z', status: 'new', payment_status: 'paid', fulfillment_type: 'pickup' as const, full_name: 'A', total: 10 };
    expect(describeRecentOrder(row).label).toBe('Nouvelle commande');
    expect(describeRecentOrder({ ...row, status: 'delivered', updated_at: '2026-10-20T12:00:00Z' }).label).toBe('Retrait terminé');
    expect(describeRecentOrder({ ...row, status: 'stock_conflict' }).tone).toBe('danger');
  });

  test('old /admin?… order links keep working: every list key is redirected, new views are valid', () => {
    expect(Object.keys(ORDER_LIST.spec)).toEqual(expect.arrayContaining(['view', 'status', 'q', 'payment', 'fulfillment', 'dateFrom', 'dateTo', 'sort']));
    expect(ORDER_LIST.parse({ view: 'to_print' }).view).toBe('to_print');
    expect(ORDER_LIST.parse({ view: 'picking_incomplete' }).view).toBe('picking_incomplete');
    expect(ORDER_VIEWS).toEqual(expect.arrayContaining(['to_prepare', 'paper_in_progress', 'late_preparation', 'tracking_issues', 'cold_chain']));
    expect(ORDER_LIST.href('/admin/orders', ORDER_LIST.parse({}), { status: 'preparing' })).toBe('/admin/orders?status=preparing');
  });
});

test.describe('before migration 160', () => {
  test('reads retry without the new columns only for a missing-column error', () => {
    expect(isMissingPreparationColumn({ code: '42703', message: 'column orders.preparation_mode does not exist' })).toBe(true);
    expect(isMissingPreparationColumn({ code: '42703', message: 'column orders.foo does not exist' })).toBe(false);
    expect(isMissingPreparationColumn({ code: '23514', message: 'preparation_mode check' })).toBe(false);
    expect(isMissingPreparationColumn(null)).toBe(false);
    expect(withoutPreparationColumns('id, status, preparation_mode, picking_list_printed_at, order_items(id, storage_type)'))
      .toBe('id, status, order_items(id, storage_type)');
  });
});
