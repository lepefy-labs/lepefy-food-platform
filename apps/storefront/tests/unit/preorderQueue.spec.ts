import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyPreorder, comparePreorders, parsePreorderView, preorderReferenceRange, type PreorderQueueInput,
} from '../../src/lib/orders/assisted/preorderQueue';
import { loadPreorderQueue } from '../../src/lib/orders/assisted/loadPreorderQueue';

const now = new Date('2026-10-03T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const make = (patch: Partial<PreorderQueueInput> = {}): PreorderQueueInput => ({
  id: '00000000-0000-4000-8000-000000000000', status: 'open', createdAt: hoursAgo(10), updatedAt: hoursAgo(10),
  expiresAt: hoursAgo(-60), declaredAt: null, declaredLabel: null, linkIssuedAt: hoursAgo(10), lastOpenedAt: null, shippingPending: false,
  ...patch,
});
const classify = (patch: Partial<PreorderQueueInput>) => classifyPreorder(make(patch), now);

test.describe('preorder classification', () => {
  test('verification needed is the first action; old declarations become a warning', () => {
    const fresh = classify({ status: 'awaiting_verification', declaredAt: hoursAgo(3), declaredLabel: 'Virement bancaire' });
    expect(fresh).toMatchObject({ group: 'to_verify', action: { label: 'Vérifier le paiement', primary: true }, warning: null, context: 'Virement bancaire déclaré il y a 3 h' });
    expect(classify({ status: 'awaiting_verification', declaredAt: hoursAgo(96), declaredLabel: 'Virement bancaire' }).warning).toBe('Virement bancaire déclaré il y a 4 j');
  });

  test('expired links, drafts and missing shipping get their own action', () => {
    expect(classify({ status: 'expired', expiresAt: hoursAgo(50) })).toMatchObject({ group: 'expired', action: { label: 'Nouveau lien' }, context: 'Expiré il y a 2 j · lien jamais consulté' });
    expect(classify({ status: 'expired', expiresAt: hoursAgo(5), lastOpenedAt: hoursAgo(30) }).context).toBe('Expiré il y a 5 h · lien consulté il y a 30 h');
    expect(classify({ status: 'draft' })).toMatchObject({ group: 'draft', action: { label: 'Envoyer le lien', primary: true }, warning: null });
    expect(classify({ status: 'draft', shippingPending: true })).toMatchObject({ action: { label: 'Compléter' }, warning: 'Frais de livraison à calculer' });
  });

  test('waiting for the customer is not an action unless a reminder is due', () => {
    expect(classify({})).toMatchObject({ group: 'waiting', action: { label: 'Voir', primary: false }, warning: null, context: 'Lien envoyé il y a 10 h · pas encore consulté' });
    expect(classify({ expiresAt: hoursAgo(-5), lastOpenedAt: hoursAgo(20) })).toMatchObject({ action: { label: 'Relancer', primary: false }, warning: 'Expire dans 5 h' });
    expect(classify({ linkIssuedAt: hoursAgo(30) }).action.label).toBe('Relancer');
    expect(classify({ linkIssuedAt: hoursAgo(30), lastOpenedAt: hoursAgo(2) }).action.label).toBe('Voir');
  });

  test('finished preorders are consultation only', () => {
    expect(classify({ status: 'completed' })).toMatchObject({ group: 'finished', action: { label: 'Voir la commande', primary: false } });
    expect(classify({ status: 'cancelled' })).toMatchObject({ group: 'finished', action: { label: 'Voir' } });
  });

  test('queue order: verify > expired > draft > waiting > finished; oldest first, finished newest first', () => {
    const rows = [
      make({ id: 'f-done-old', status: 'completed', updatedAt: hoursAgo(100) }),
      make({ id: 'e-wait-later', expiresAt: hoursAgo(-60) }),
      make({ id: 'd-wait-soon', expiresAt: hoursAgo(-3) }),
      make({ id: 'c-draft', status: 'draft' }),
      make({ id: 'b-expired', status: 'expired', expiresAt: hoursAgo(5) }),
      make({ id: 'a2-verify-new', status: 'awaiting_verification', declaredAt: hoursAgo(2) }),
      make({ id: 'a1-verify-old', status: 'awaiting_verification', declaredAt: hoursAgo(40) }),
      make({ id: 'g-done-new', status: 'cancelled', updatedAt: hoursAgo(1) }),
    ].map((input) => ({ input, operation: classifyPreorder(input, now) }));
    expect(rows.sort(comparePreorders).map(({ input }) => input.id)).toEqual(
      ['a1-verify-old', 'a2-verify-new', 'b-expired', 'c-draft', 'd-wait-soon', 'e-wait-later', 'g-done-new', 'f-done-old']);
  });

  test('views and reference search', () => {
    expect(parsePreorderView(null)).toBe('to_treat');
    expect(parsePreorderView('active')).toBe('to_treat');
    expect(parsePreorderView('waiting')).toBe('waiting');
    expect(parsePreorderView('open')).toBe('to_treat');
    expect(preorderReferenceRange('P-9C2E11A0')).toEqual({ from: '9c2e11a0-0000-0000-0000-000000000000', to: '9c2e11a0-ffff-ffff-ffff-ffffffffffff' });
    expect(preorderReferenceRange('9c2e11a0')).not.toBeNull();
    expect(preorderReferenceRange('Mireille')).toBeNull();
  });
});

// ─── Loader: sort before pagination, KPIs, tenant scoping ──────────────────
const TENANT = '11111111-1111-4111-8111-111111111111';
const row = (id: string, patch: Record<string, unknown>) => ({
  id, status: 'open', full_name: `Client ${id}`, email: null, phone: '+39 333', sales_channel: 'whatsapp',
  items: [{ productId: 'p', name: 'Garri', price: 5, quantity: 2 }], shipping_total: 0, ambassador_discount_amount: null,
  fulfillment_type: 'pickup', created_at: hoursAgo(10), updated_at: hoursAgo(10), expires_at: hoursAgo(-60), order_id: null,
  external_payment_type: null, external_payment_label: null, declared_payment_at: null, pay_token_hash: 'h', pay_token_issued_at: hoursAgo(10),
  shipping_details: null, ...patch,
});
const ACTIVE = [
  row('00000001-0000-4000-8000-000000000001', {}),
  row('00000002-0000-4000-8000-000000000002', { status: 'awaiting_verification', declared_payment_at: hoursAgo(30), external_payment_label: 'Virement' }),
  row('00000003-0000-4000-8000-000000000003', { status: 'draft' }),
  row('00000004-0000-4000-8000-000000000004', { status: 'expired', expires_at: hoursAgo(2) }),
];
type Op = [string, unknown[]];
function fakeDb() {
  const queries: Op[][] = [];
  const db = {
    from(table: string) {
      const ops: Op[] = [['from', [table]]];
      queries.push(ops);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'or', 'gte', 'lte', 'order', 'limit', 'range']) builder[method] = (...args: unknown[]) => { ops.push([method, args]); return builder; };
      builder.then = (resolve: (value: unknown) => void) => resolve(answer(ops));
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, queries };
}
function answer(ops: Op[]) {
  if (ops[0]![1][0] === 'assisted_order_events') return { data: [], error: null };
  const select = ops.find(([method]) => method === 'select')!;
  if ((select[1][1] as { head?: boolean } | undefined)?.head) return { data: null, count: 3, error: null };
  return { data: ACTIVE, error: null };
}

test('loader: "À traiter" excludes waiting, sorts before pagination and counts KPIs on the whole queue', async () => {
  const { db } = fakeDb();
  const first = await loadPreorderQueue(db, TENANT, { view: 'to_treat', q: '', page: 1, pageSize: 2, now });
  expect(first.preorders.map((p) => p.group)).toEqual(['to_verify', 'expired']);
  expect(first.total).toBe(3);
  expect(first.totalPages).toBe(2);
  expect(first.kpis).toEqual({ to_verify: 1, expired: 1, draft: 1, waiting: 1 });
  expect(first.toTreatCount).toBe(3);
  expect(first.preorders[0]).toMatchObject({ reference: 'P-00000002', warning: 'Virement déclaré il y a 30 h', action: { label: 'Vérifier le paiement' } });
  const second = await loadPreorderQueue(db, TENANT, { view: 'to_treat', q: '', page: 2, pageSize: 2, now });
  expect(second.preorders.map((p) => p.group)).toEqual(['draft']);
  const waiting = await loadPreorderQueue(db, TENANT, { view: 'waiting', q: '', page: 1, pageSize: 30, now });
  expect(waiting.preorders.map((p) => p.group)).toEqual(['waiting']);
  const search = await loadPreorderQueue(db, TENANT, { view: 'to_treat', q: 'P-00000003', page: 1, pageSize: 30, now });
  expect(search.preorders.map((p) => p.reference)).toEqual(['P-00000003']);
});

test('loader: every query is tenant-scoped and limited to assisted sessions', async () => {
  const { db, queries } = fakeDb();
  await loadPreorderQueue(db, TENANT, { view: 'all', q: 'Client', page: 1, pageSize: 30, now });
  expect(queries.length).toBeGreaterThan(3);
  for (const ops of queries) {
    expect(ops.some(([method, args]) => method === 'eq' && args[0] === 'tenant_id' && args[1] === TENANT)).toBe(true);
    if (ops[0]![1][0] === 'checkout_sessions') expect(ops.some(([method, args]) => method === 'eq' && args[0] === 'origin' && args[1] === 'assisted')).toBe(true);
  }
});
