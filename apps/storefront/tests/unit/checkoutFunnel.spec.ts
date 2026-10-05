import { expect, test } from '@playwright/test';
import { parseFunnelRange, recoverableCarts, sessionValue, summarizeFunnel, type FunnelSession } from '../../src/lib/admin/checkoutFunnel';

const now = new Date('2026-10-05T10:00:00Z');
let n = 0;
const session = (status: string, extra: Partial<FunnelSession> = {}): FunnelSession => ({
  id: `s${n += 1}`, status, created_at: '2026-10-04T10:00:00Z', email: 'a@b.it', full_name: null, phone: null,
  items: [{ price: 10, quantity: 2 }], shipping_total: 5, ambassador_discount_amount: 0, resume_count: 0, order_id: null, ...extra,
});

test('session value', () => {
  expect(sessionValue(session('open'))).toBe(25);
  expect(sessionValue(session('open', { ambassador_discount_amount: 2.5, shipping_total: '4.90' }))).toBe(22.4);
  expect(sessionValue(session('open', { items: null }))).toBe(5);
  expect(sessionValue(session('open', { items: [{ price: 'x', quantity: 1 }], shipping_total: 0 }))).toBe(0);
});

test('conversion ignores running checkouts', () => {
  const summary = summarizeFunnel([
    session('completed'), session('completed', { resume_count: 1 }), session('open'), session('awaiting_verification'), session('cancelled'),
  ]);
  expect(summary).toMatchObject({ started: 5, completed: 2, inProgress: 2, open: 1, awaitingVerification: 1, cancelled: 1, expired: 0, resumed: 1, recovered: 1 });
  expect(summary.conversionRate).toBe(66.7);
  expect(summary.value).toEqual({ converted: 50, pending: 50, lost: 25 });
  expect(summarizeFunnel([session('open')]).conversionRate).toBeNull();
});

test('recoverable carts: recent, contactable, highest value first', () => {
  const carts = recoverableCarts([
    session('open', { full_name: 'Awa' }),
    session('expired', { items: [{ price: 50, quantity: 1 }] }),
    session('expired', { created_at: '2026-09-20T10:00:00Z' }),
    session('expired', { email: null, phone: null }),
    session('completed'),
  ], now);
  expect(carts.map((cart) => cart.value)).toEqual([55, 25]);
  expect(carts[1]?.customer).toBe('Awa');
});

test('range', () => {
  expect(parseFunnelRange('7')).toBe(7);
  expect(parseFunnelRange('90')).toBe(90);
  expect(parseFunnelRange('x')).toBe(30);
});
