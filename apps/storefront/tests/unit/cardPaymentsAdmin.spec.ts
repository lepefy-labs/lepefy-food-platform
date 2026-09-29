import { expect, test } from '@playwright/test';
import {
  ABANDONED_AFTER_MS, displayStatus, parseDay, parsePage, parsePeriod, parseStatusFilter, periodBounds, periodStart, referenceRange, sanitizeSearch, shopDay, stripeDashboardUrl,
} from '../../src/lib/card/cardPaymentsAdmin';
import { cardPaymentReference } from '../../src/lib/card/cardPaymentOutcome';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { permissionForAdminPath } from '../../src/lib/auth/adminRoutePermissions';

const now = new Date('2026-09-29T10:00:00.000Z');

test('display status: paid, then in progress for an hour, then not finalised', () => {
  expect(displayStatus({ status: 'paid', created_at: '2020-01-01T00:00:00Z' }, now)).toBe('paid');
  expect(displayStatus({ status: 'pending', created_at: new Date(now.getTime() - 5 * 60_000).toISOString() }, now)).toBe('in_progress');
  expect(displayStatus({ status: 'pending', created_at: new Date(now.getTime() - ABANDONED_AFTER_MS - 1).toISOString() }, now)).toBe('abandoned');
});

test('a CP reference maps to the uuid range that contains its payment', () => {
  const id = 'a82f31c4-9d1e-4b2a-8c3f-000000000001';
  const range = referenceRange(cardPaymentReference(id))!;
  expect(range).toEqual({ from: 'a82f3100-0000-0000-0000-000000000000', to: 'a82f31ff-ffff-ffff-ffff-ffffffffffff' });
  expect(id >= range.from && id <= range.to).toBe(true);
  expect('a82f3200-0000-4000-8000-000000000000' <= range.to).toBe(false);
  expect(referenceRange(' cp-a82f31 ')).toEqual(range);
  expect(referenceRange('CPA82F31')).toEqual(range);
  expect(referenceRange('CP-A82F3')).toBeNull();
  expect(referenceRange('Marie')).toBeNull();
});

test('periods: today starts at midnight in the shop time zone', () => {
  // 10:00 UTC = 12:00 in Rome (CEST): today started at 22:00 UTC the day before.
  expect(periodStart('today', now)?.toISOString()).toBe('2026-09-28T22:00:00.000Z');
  expect(periodStart('7d', now)?.toISOString()).toBe('2026-09-22T10:00:00.000Z');
  expect(periodStart('all', now)).toBeNull();
  expect(parsePeriod('bogus')).toBe('7d');
  expect(parseStatusFilter('unfinished')).toBe('unfinished');
  expect(parseStatusFilter('x')).toBe('all');
  expect(parsePage('0')).toBe(1);
  expect(parsePage('3')).toBe(3);
});

test('custom range: whole shop-time days, end day included, DST-safe', () => {
  expect(parsePeriod('custom')).toBe('custom');
  expect(periodStart('custom', now)).toBeNull();
  // Summer (CEST, UTC+2) start, winter (CET, UTC+1) end: the 25/10 DST switch is crossed.
  const { since, until } = periodBounds('custom', { from: '2026-09-01', to: '2026-10-31' }, now);
  expect(since?.toISOString()).toBe('2026-08-31T22:00:00.000Z');
  expect(until?.toISOString()).toBe('2026-10-31T23:00:00.000Z');
  // A single day spans its 24 local hours.
  const day = periodBounds('custom', { from: '2026-09-29', to: '2026-09-29' }, now);
  expect(day.since?.toISOString()).toBe('2026-09-28T22:00:00.000Z');
  expect(day.until?.toISOString()).toBe('2026-09-29T22:00:00.000Z');
});

test('custom range: reversed days are swapped, missing or malformed days leave that side open', () => {
  expect(periodBounds('custom', { from: '2026-09-29', to: '2026-09-01' }, now)).toEqual(periodBounds('custom', { from: '2026-09-01', to: '2026-09-29' }, now));
  expect(periodBounds('custom', { from: '2026-09-01' }, now).until).toBeNull();
  expect(periodBounds('custom', { to: '2026-09-01' }, now).since).toBeNull();
  expect(periodBounds('custom', { from: 'bogus', to: '2026-02-30' }, now)).toEqual({ since: null, until: null });
  expect(periodBounds('7d', { from: '2026-01-01', to: '2026-01-02' }, now)).toEqual({ since: periodStart('7d', now), until: null });
  expect(parseDay('2026-02-29')).toBeNull();
  expect(parseDay('2028-02-29')).toBe('2028-02-29');
  expect(parseDay('2026-9-1')).toBeNull();
  expect(shopDay(new Date('2026-09-29T22:30:00.000Z'))).toBe('2026-09-30');
});

test('search input is safe for ilike and Stripe links only accept PaymentIntent ids', () => {
  expect(sanitizeSearch(" marie%,(o'r)*  ")).toBe('marieor');
  expect(stripeDashboardUrl('pi_3Q123abc')).toBe('https://dashboard.stripe.com/payments/pi_3Q123abc');
  expect(stripeDashboardUrl('javascript:alert(1)')).toBeNull();
  expect(stripeDashboardUrl(null)).toBeNull();
});

test('permissions: orders.view reads, orders.manage resends, nothing else is mapped', () => {
  expect(permissionForAdminPath('/admin/paiements-carte', 'shop')).toBe('orders.view');
  expect(permissionForAdminApi('/api/admin/card-payments', 'GET')).toBe('orders.view');
  expect(permissionForAdminApi('/api/admin/card-payments', 'POST')).toBeNull();
  expect(permissionForAdminApi('/api/admin/card-payments/abc/resend-confirmation', 'POST')).toBe('orders.manage');
  expect(permissionForAdminApi('/api/admin/card-payments/abc/resend-confirmation', 'GET')).toBeNull();
  expect(permissionForAdminApi('/api/admin/card/poster', 'POST')).toBe('tenant_settings.manage');
});
