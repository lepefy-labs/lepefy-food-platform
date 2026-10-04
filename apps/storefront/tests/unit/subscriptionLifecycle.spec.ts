import { expect, test } from '@playwright/test';
import {
  coveredMonth,
  isAdminApiAllowedWhenSuspended,
  isAdminPathAllowedWhenSuspended,
  isMissingLifecycleSchema,
  isSuspendedAt,
  monthEnd,
  nextPaidUntil,
  plural,
  shouldWarnTenant,
  subscriptionErrorMessage,
  subscriptionState,
  transferReference,
  type SubscriptionRow,
} from '../../src/lib/billing/subscriptionRules';
import { endOfDayUtc, platformSubscriptionActionSchema, transferPaidAt } from '../../src/lib/billing/platformSubscriptionActions';

const d = (iso: string) => new Date(iso);
const row = (patch: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  status: 'active',
  suspended_at: null,
  suspension_mode: 'manual',
  paid_until: '2026-09-30T23:59:59Z',
  grace_days: 15,
  ...patch,
});

test.describe('renewal rule (mirror of migration 144)', () => {
  test('month end', () => {
    expect(monthEnd(d('2026-09-15T10:00:00Z')).toISOString()).toBe('2026-09-30T23:59:59.000Z');
    expect(monthEnd(d('2026-02-01T00:00:00Z')).toISOString()).toBe('2026-02-28T23:59:59.000Z');
  });

  test('same cases as the SQL test', () => {
    const cases: Array<[string | null, string, boolean, string]> = [
      ['2026-09-30T23:59:59Z', '2026-10-25T09:00:00Z', false, '2026-10-31T23:59:59.000Z'],
      ['2026-10-31T23:59:59Z', '2026-10-20T09:00:00Z', false, '2026-11-30T23:59:59.000Z'],
      ['2026-12-31T23:59:59Z', '2026-12-28T09:00:00Z', false, '2027-01-31T23:59:59.000Z'],
      ['2026-07-31T23:59:59Z', '2026-10-25T09:00:00Z', false, '2026-08-31T23:59:59.000Z'],
      ['2026-07-31T23:59:59Z', '2026-10-25T09:00:00Z', true, '2026-10-31T23:59:59.000Z'],
      ['2026-11-30T23:59:59Z', '2026-10-25T09:00:00Z', true, '2026-12-31T23:59:59.000Z'],
      [null, '2026-10-25T09:00:00Z', false, '2026-10-31T23:59:59.000Z'],
    ];
    for (const [paidUntil, paidAt, suspended, expected] of cases) {
      expect(nextPaidUntil(paidUntil ? d(paidUntil) : null, d(paidAt), suspended).toISOString(), `${paidUntil} ${paidAt} ${suspended}`).toBe(expected);
    }
  });
});

test.describe('suspension', () => {
  test('manual suspension applies from suspended_at', () => {
    const suspended = row({ status: 'suspended', suspended_at: '2026-10-10T00:00:00Z' });
    expect(isSuspendedAt(suspended, d('2026-10-11T00:00:00Z'))).toEqual({ suspended: true, by: 'manual' });
    expect(isSuspendedAt(suspended, d('2026-10-09T00:00:00Z')).suspended).toBe(false);
  });

  test('automatic policy suspends after paid_until + grace days, manual never does', () => {
    const auto = row({ suspension_mode: 'automatic', grace_days: 15 });
    expect(isSuspendedAt(auto, d('2026-10-15T23:59:00Z')).suspended).toBe(false);
    expect(isSuspendedAt(auto, d('2026-10-16T00:00:00Z'))).toEqual({ suspended: true, by: 'automatic' });
    expect(isSuspendedAt(row(), d('2027-06-01T00:00:00Z')).suspended).toBe(false);
  });

  test('states and warnings', () => {
    const now = d('2026-10-04T10:00:00Z');
    const overdue = subscriptionState(row(), now);
    expect(overdue.kind).toBe('overdue');
    expect(overdue.daysOverdue).toBe(4);
    expect(overdue.autoSuspendAt).toBeNull();
    expect(shouldWarnTenant(overdue)).toBe(false);

    const auto = subscriptionState(row({ suspension_mode: 'automatic', grace_days: 7 }), now);
    expect(auto.kind).toBe('overdue');
    expect(auto.daysUntilAutoSuspend).toBe(4);
    expect(shouldWarnTenant(auto)).toBe(true);

    expect(subscriptionState(row({ paid_until: '2026-10-08T23:59:59Z' }), now).kind).toBe('due_soon');
    expect(subscriptionState(row({ paid_until: '2026-10-04T23:59:59Z' }), now).daysLeft).toBe(0);
    expect(subscriptionState(row({ paid_until: '2026-12-31T23:59:59Z' }), now).kind).toBe('active');
    expect(subscriptionState(row({ paid_until: null }), now).kind).toBe('undefined');
    expect(subscriptionState(null, now).kind).toBe('undefined');
    const suspended = subscriptionState(row({ status: 'suspended', suspended_at: '2026-10-01T00:00:00Z' }), now);
    expect(suspended.kind).toBe('suspended');
    expect(shouldWarnTenant(suspended)).toBe(true);
  });

  test('plural', () => {
    expect(plural(1, 'jour')).toBe('1 jour');
    expect(plural(0, 'jour')).toBe('0 jours');
    expect(plural(3, 'module suspendu', 'modules suspendus')).toBe('3 modules suspendus');
  });
});

test('covered month and transfer reference', () => {
  const now = d('2026-10-04T10:00:00Z');
  expect(coveredMonth(row(), now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  expect(coveredMonth(row({ paid_until: '2026-12-31T23:59:59Z' }), now).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  expect(coveredMonth(null, now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  expect(transferReference('chloefood', d('2026-10-01T00:00:00Z'))).toBe('LEPEFY CHLOEFOOD 2026-10');
  expect(transferReference('lepefy test!', d('2027-01-01T00:00:00Z'))).toBe('LEPEFY LEPEFY-TEST 2027-01');
});

test('suspended tenant keeps billing and read-only orders', () => {
  for (const path of ['/admin', '/admin/billing', '/admin/orders/abc', '/admin/securite']) expect(isAdminPathAllowedWhenSuspended(path), path).toBe(true);
  for (const path of ['/admin/catalogue', '/admin/clients', '/admin/billing/x', '/admin/livraison']) expect(isAdminPathAllowedWhenSuspended(path), path).toBe(false);
  expect(isAdminApiAllowedWhenSuspended('orders.view', 'GET')).toBe(true);
  expect(isAdminApiAllowedWhenSuspended('orders.view', 'PATCH')).toBe(false);
  expect(isAdminApiAllowedWhenSuspended('catalog.view', 'GET')).toBe(false);
});

test('error mapping and schema detection', () => {
  expect(subscriptionErrorMessage({ message: 'reason_required' })).toContain('motif');
  expect(subscriptionErrorMessage({ message: 'boom' })).toContain('migration 144');
  expect(isMissingLifecycleSchema({ code: '42703', message: 'column does not exist' })).toBe(true);
  expect(isMissingLifecycleSchema({ code: 'PGRST202' })).toBe(true);
  expect(isMissingLifecycleSchema({ code: 'P0001', message: 'subscription_not_found' })).toBe(false);
  expect(isMissingLifecycleSchema(null)).toBe(false);
});

test('platform action schema', () => {
  expect(platformSubscriptionActionSchema.safeParse({ action: 'suspend', reason: 'Impayé' }).success).toBe(true);
  expect(platformSubscriptionActionSchema.safeParse({ action: 'suspend', reason: ' a ' }).success).toBe(false);
  expect(platformSubscriptionActionSchema.safeParse({ action: 'set_payment_link', url: 'http://x.test', reason: 'Lien' }).success).toBe(false);
  expect(platformSubscriptionActionSchema.safeParse({ action: 'set_payment_link', url: null, reason: 'Retrait' }).success).toBe(true);
  expect(platformSubscriptionActionSchema.safeParse({ action: 'suspend_module', module: 'events', reason: 'Maintenance' }).success).toBe(true);
  expect(platformSubscriptionActionSchema.safeParse({ action: 'suspend_module', module: 'loyalty', reason: 'Maintenance' }).success).toBe(false);
  expect(platformSubscriptionActionSchema.safeParse({ action: 'record_transfer', amountEur: 89, paidOn: '2026-10-02' }).success).toBe(true);
  expect(platformSubscriptionActionSchema.safeParse({ action: 'set_suspension_policy', mode: 'automatic', graceDays: 400, reason: 'Test' }).success).toBe(false);
  expect(endOfDayUtc('2026-10-31')).toBe('2026-10-31T23:59:59.000Z');
  const now = d('2026-10-04T08:00:00Z');
  expect(transferPaidAt('2026-10-02', now)).toBe('2026-10-02T12:00:00.000Z');
  expect(transferPaidAt('2026-10-04', now)).toBe(now.toISOString());
});

test.describe('service state engine', () => {
  // Imported lazily: the module also pulls next/cache and the Supabase client.
  test('fail-open without schema, module and global suspension', async () => {
    const { serviceStateFromRows, isModuleAvailable, moduleForFeature } = await import('../../src/lib/billing/tenantServiceState');
    const now = d('2026-10-20T00:00:00Z');
    const missing = serviceStateFromRows({ schemaReady: false, subscription: null, modules: [] }, now);
    expect(missing.suspended).toBe(false);
    expect(isModuleAvailable(missing, 'shop')).toBe(true);

    const eventsOff = serviceStateFromRows({ schemaReady: true, subscription: { ...row(), suspension_reason: null }, modules: ['events'] }, now);
    expect(isModuleAvailable(eventsOff, 'shop')).toBe(true);
    expect(isModuleAvailable(eventsOff, 'events')).toBe(false);

    const auto = serviceStateFromRows({ schemaReady: true, subscription: { ...row({ suspension_mode: 'automatic', grace_days: 15 }), suspension_reason: null }, modules: [] }, now);
    expect(auto).toMatchObject({ suspended: true, suspendedBy: 'automatic', suspensionReason: null });
    expect(isModuleAvailable(auto, 'digital_card')).toBe(false);

    const manual = serviceStateFromRows({ schemaReady: true, subscription: { ...row({ status: 'suspended', suspended_at: '2026-10-01T00:00:00Z' }), suspension_reason: 'Impayé' }, modules: [] }, now);
    expect(manual).toMatchObject({ suspended: true, suspendedBy: 'manual', suspensionReason: 'Impayé' });

    expect(moduleForFeature('nala_analytics')).toBe('ai');
    expect(moduleForFeature('reviews')).toBe('reviews');
    expect(moduleForFeature('loyalty')).toBeNull();
  });
});
