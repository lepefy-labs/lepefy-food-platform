import { expect, test } from '@playwright/test';
import { dueSubscriptionReminder, runSubscriptionReminders, suspensionJustStarted } from '../../src/lib/billing/subscriptionReminders';
import type { SubscriptionRow } from '../../src/lib/billing/subscriptionRules';
import { subscriptionReminderEmail } from '../../src/lib/notifications/customerEmails';

const T = '11111111-1111-4111-8111-111111111111';
const d = (iso: string) => new Date(iso);
const auto = (patch: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  status: 'active', suspended_at: null, suspension_mode: 'automatic', paid_until: '2026-09-30T23:59:59Z', grace_days: 15, ...patch,
});
// Automatic suspension: 2026-10-15T23:59:59Z.

test.describe('which email is due', () => {
  test('nothing more than 7 days before, d7 inside the window, d1 the last day', () => {
    expect(dueSubscriptionReminder(T, auto(), d('2026-10-05T08:00:00Z'))).toBeNull();
    const d7 = dueSubscriptionReminder(T, auto(), d('2026-10-09T08:00:00Z'));
    expect(d7).toMatchObject({ kind: 'd7', daysLeft: 7, idempotencyKey: `subscription-reminder:${T}:2026-10-15T23:59:59.000Z:d7` });
    expect(dueSubscriptionReminder(T, auto(), d('2026-10-12T08:00:00Z'))?.kind).toBe('d7');
    expect(dueSubscriptionReminder(T, auto(), d('2026-10-15T08:00:00Z'))).toMatchObject({ kind: 'd1', daysLeft: 1 });
  });

  test('same key all window long, so the ledger sends each kind once', () => {
    const a = dueSubscriptionReminder(T, auto(), d('2026-10-10T08:00:00Z'));
    const b = dueSubscriptionReminder(T, auto(), d('2026-10-11T08:00:00Z'));
    expect(a?.idempotencyKey).toBe(b?.idempotencyKey);
  });

  test('suspension notice once, recent suspensions only', () => {
    const notice = dueSubscriptionReminder(T, auto(), d('2026-10-17T08:00:00Z'));
    expect(notice).toMatchObject({ kind: 'suspended', idempotencyKey: `subscription-suspended:${T}:2026-10-15T23:59:59.000Z` });
    expect(dueSubscriptionReminder(T, auto(), d('2026-11-30T08:00:00Z'))).toBeNull();
    const manual = { ...auto({ suspension_mode: 'manual', status: 'suspended', suspended_at: '2026-10-02T10:00:00Z' }) };
    expect(dueSubscriptionReminder(T, manual, d('2026-10-03T08:00:00Z'))?.kind).toBe('suspended');
  });

  test('manual mode never warns', () => {
    expect(dueSubscriptionReminder(T, auto({ suspension_mode: 'manual' }), d('2026-10-14T08:00:00Z'))).toBeNull();
  });
});

test('runner counts outcomes and isolates failures', async () => {
  const sent: string[] = [];
  const outcomes = await runSubscriptionReminders({
    listTenants: async () => [
      { tenantId: 'a', row: auto() },
      { tenantId: 'b', row: auto({ suspension_mode: 'manual' }) },
      { tenantId: 'c', row: auto() },
      { tenantId: 'd', row: auto() },
    ],
    recipients: async (tenantId) => (tenantId === 'c' ? [] : ['owner@x.test']),
    send: async (tenantId, decision) => {
      if (tenantId === 'd') throw new Error('transport');
      sent.push(`${tenantId}:${decision.kind}`);
      return true;
    },
  }, d('2026-10-12T08:00:00Z'));
  expect(outcomes).toEqual({ sent: 1, not_due: 1, no_recipients: 1, failed: 1, cache_invalidated: 0 });
  expect(sent).toEqual(['a:d7']);
});

test('emails say when and link to billing', () => {
  const warning = subscriptionReminderEmail({ tenantName: 'Chloe <Food>', kind: 'd1', daysLeft: 1, suspendOn: '15 octobre 2026', paidUntil: '30 septembre 2026', billingUrl: 'https://shop.test/admin/billing' });
  expect(warning.subject).toContain('demain');
  expect(warning.html).toContain('Chloe &lt;Food&gt;');
  expect(warning.html).toContain('https://shop.test/admin/billing');
  const suspended = subscriptionReminderEmail({ tenantName: 'Chloe', kind: 'suspended', daysLeft: 0, suspendOn: '', paidUntil: '', billingUrl: null });
  expect(suspended.subject).toContain('suspendu');
});

test('cache is dropped once, right after an automatic suspension starts', async () => {
  expect(suspensionJustStarted(auto(), d('2026-10-16T01:00:00Z'))).toBe(true);
  expect(suspensionJustStarted(auto(), d('2026-10-16T04:00:00Z'))).toBe(false);
  expect(suspensionJustStarted(auto(), d('2026-10-15T20:00:00Z'))).toBe(false);
  const invalidated: string[] = [];
  const outcomes = await runSubscriptionReminders({
    listTenants: async () => [{ tenantId: 'a', row: auto() }, { tenantId: 'b', row: auto({ suspension_mode: 'manual' }) }],
    recipients: async () => ['owner@x.test'],
    send: async () => true,
    invalidate: (tenantId) => invalidated.push(tenantId),
  }, d('2026-10-16T01:00:00Z'));
  expect(invalidated).toEqual(['a']);
  expect(outcomes.cache_invalidated).toBe(1);
});
