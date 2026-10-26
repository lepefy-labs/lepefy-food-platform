import { expect, test } from '@playwright/test';
import { calendarDaysUntil, describeDue, dueSubscriptionReminder, PLATFORM_ALERT_KINDS, runSubscriptionReminders, suspensionJustStarted } from '../../src/lib/billing/subscriptionReminders';
import type { SubscriptionRow } from '../../src/lib/billing/subscriptionRules';
import { subscriptionPaymentReceivedEmail, subscriptionReminderEmail } from '../../src/lib/notifications/customerEmails';

const T = '11111111-1111-4111-8111-111111111111';
const d = (iso: string) => new Date(iso);
const auto = (patch: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  status: 'active', suspended_at: null, suspension_mode: 'automatic', paid_until: '2026-09-30T23:59:59Z', grace_days: 15, ...patch,
});
// Automatic suspension: 2026-10-15T23:59:59Z.

test.describe('which email is due', () => {
  test('nothing more than 7 days before, d7 inside the window, d1 the last day', () => {
    // 2026-10-05 is D+5: only the due-date reminder (overdue_d3) applies there.
    expect(dueSubscriptionReminder(T, auto(), d('2026-10-05T08:00:00Z'))?.kind).toBe('overdue_d3');
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

  test('manual mode never warns about a suspension', () => {
    // D+14: past the last due-date window, and no automatic suspension.
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

// Due-date reminders: paid_until 2026-10-31T23:59:59Z (ChloeFood's convention), every mode.
const manual = (patch: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  status: 'active', suspended_at: null, suspension_mode: 'manual', paid_until: '2026-10-31T23:59:59Z', grace_days: 15, ...patch,
});
const DUE = '2026-10-31T23:59:59.000Z';

test.describe('due-date reminders (D-7, D-3, D0, D+3)', () => {
  test('each step inside its window, in manual mode', () => {
    expect(dueSubscriptionReminder(T, manual(), d('2026-10-23T09:00:00Z'))).toBeNull(); // D-8
    expect(dueSubscriptionReminder(T, manual(), d('2026-10-24T09:00:00Z'))).toMatchObject({ kind: 'due_d7', daysToDue: 7, idempotencyKey: `subscription-due:${T}:${DUE}:due_d7` });
    expect(dueSubscriptionReminder(T, manual(), d('2026-10-27T09:00:00Z'))).toMatchObject({ kind: 'due_d7', daysToDue: 4 });
    expect(dueSubscriptionReminder(T, manual(), d('2026-10-28T09:00:00Z'))).toMatchObject({ kind: 'due_d3', daysToDue: 3 });
    expect(dueSubscriptionReminder(T, manual(), d('2026-10-30T09:00:00Z'))).toMatchObject({ kind: 'due_d3', daysToDue: 1 });
    expect(dueSubscriptionReminder(T, manual(), d('2026-10-31T09:00:00Z'))).toMatchObject({ kind: 'due_d0', daysToDue: 0, suspendOn: null });
    expect(dueSubscriptionReminder(T, manual(), d('2026-11-02T09:00:00Z'))).toMatchObject({ kind: 'due_d0', daysToDue: -2 });
    expect(dueSubscriptionReminder(T, manual(), d('2026-11-03T09:00:00Z'))).toMatchObject({ kind: 'overdue_d3', daysToDue: -3 });
    expect(dueSubscriptionReminder(T, manual(), d('2026-11-10T09:00:00Z'))).toMatchObject({ kind: 'overdue_d3', daysToDue: -10 });
    expect(dueSubscriptionReminder(T, manual(), d('2026-11-11T09:00:00Z'))).toBeNull(); // past the last window
  });

  test('automatic mode gets the same due-date steps, with the suspension date', () => {
    const row = manual({ suspension_mode: 'automatic' });
    expect(dueSubscriptionReminder(T, row, d('2026-10-28T09:00:00Z'))).toMatchObject({ kind: 'due_d3', suspendOn: new Date('2026-11-15T23:59:59Z') });
    expect(dueSubscriptionReminder(T, row, d('2026-11-03T09:00:00Z'))?.kind).toBe('overdue_d3');
    // From D+8 the suspension warning takes over.
    expect(dueSubscriptionReminder(T, row, d('2026-11-09T09:00:00Z'))?.kind).toBe('d7');
  });

  test('a payment moves paid_until: the old period stops, the next one starts later', () => {
    const paid = manual({ paid_until: '2026-11-30T23:59:59Z' });
    expect(dueSubscriptionReminder(T, paid, d('2026-10-31T09:00:00Z'))).toBeNull();
    expect(dueSubscriptionReminder(T, paid, d('2026-11-03T09:00:00Z'))).toBeNull();
    expect(dueSubscriptionReminder(T, paid, d('2026-11-23T09:00:00Z'))?.idempotencyKey).toBe(`subscription-due:${T}:2026-11-30T23:59:59.000Z:due_d7`);
  });

  test('never at night, never when suspended or without a due date', () => {
    expect(dueSubscriptionReminder(T, manual(), d('2026-10-28T06:59:00Z'))).toBeNull();
    expect(dueSubscriptionReminder(T, manual(), d('2026-10-28T07:00:00Z'))?.kind).toBe('due_d3');
    expect(dueSubscriptionReminder(T, manual({ paid_until: null }), d('2026-10-28T09:00:00Z'))).toBeNull();
    const suspendedLongAgo = manual({ status: 'suspended', suspended_at: '2026-09-01T10:00:00Z' });
    expect(dueSubscriptionReminder(T, suspendedLongAgo, d('2026-10-28T09:00:00Z'))).toBeNull();
  });

  test('same key all window long; a scheduler that was down sends only the latest step', () => {
    const a = dueSubscriptionReminder(T, manual(), d('2026-10-24T09:00:00Z'));
    const b = dueSubscriptionReminder(T, manual(), d('2026-10-26T20:00:00Z'));
    expect(a?.idempotencyKey).toBe(b?.idempotencyKey);
    // Down from D-7 to D0: D0 is sent, the missed D-3 is not.
    expect(dueSubscriptionReminder(T, manual(), d('2026-10-31T09:00:00Z'))?.kind).toBe('due_d0');
  });

  test('month lengths and leap years use calendar days', () => {
    expect(calendarDaysUntil(d('2027-02-28T23:59:59Z'), d('2027-02-21T09:00:00Z'))).toBe(7);
    expect(calendarDaysUntil(d('2028-02-29T23:59:59Z'), d('2028-02-26T09:00:00Z'))).toBe(3);
    expect(calendarDaysUntil(d('2026-09-30T23:59:59Z'), d('2026-10-03T09:00:00Z'))).toBe(-3);
  });

  test('wording', () => {
    expect(describeDue(7)).toBe('dans 7 jours');
    expect(describeDue(1)).toBe('demain');
    expect(describeDue(0)).toBe('aujourd’hui');
    expect(describeDue(-1)).toBe('dépassée depuis 1 jour');
    expect(describeDue(-3)).toBe('dépassée depuis 3 jours');
  });

  test('Lepefy is told only at D0 and D+3', () => {
    expect([...PLATFORM_ALERT_KINDS].sort()).toEqual(['due_d0', 'overdue_d3']);
  });
});

test('runner: tenants are independent, a provider failure is counted and retried next run', async () => {
  const sent: string[] = [];
  const outcomes = await runSubscriptionReminders({
    listTenants: async () => [
      { tenantId: 'a', row: manual() },
      { tenantId: 'b', row: manual({ paid_until: '2026-11-30T23:59:59Z' }) },
      { tenantId: 'c', row: manual() },
    ],
    recipients: async (tenantId) => [`${tenantId}@x.test`],
    send: async (tenantId, decision, to) => {
      if (tenantId === 'c') return false; // transport refused
      sent.push(`${tenantId}:${decision.kind}:${to.join(',')}`);
      return true;
    },
  }, d('2026-10-28T09:00:00Z'));
  expect(outcomes).toEqual({ sent: 1, not_due: 1, no_recipients: 0, failed: 1, cache_invalidated: 0 });
  expect(sent).toEqual(['a:due_d3:a@x.test']);
});

test('due-date, overdue and payment emails', () => {
  const base = { tenantName: 'Chloe <Food>', daysLeft: 0, suspendOn: '', paidUntil: '31 octobre 2026', billingUrl: 'https://shop.test/admin/billing', coveredMonth: 'novembre 2026' };
  const due = subscriptionReminderEmail({ ...base, kind: 'due_d3', dueWhen: 'dans 3 jours' });
  expect(due.subject).toBe('Abonnement Lepefy : échéance dans 3 jours (31 octobre 2026) — Chloe <Food>');
  expect(due.html).toContain('novembre 2026');
  expect(due.html).toContain('Chloe &lt;Food&gt;');
  expect(due.html).not.toContain('suspendu le');
  const overdue = subscriptionReminderEmail({ ...base, kind: 'overdue_d3', dueWhen: 'dépassée depuis 3 jours' });
  expect(overdue.subject).toContain('paiement en retard');
  expect(overdue.html).toContain('reste actif');
  const withSuspension = subscriptionReminderEmail({ ...base, kind: 'overdue_d3', dueWhen: 'dépassée depuis 3 jours', suspendOn: '15 novembre 2026' });
  expect(withSuspension.html).toContain('suspendu le <strong>15 novembre 2026</strong>');
  const receipt = subscriptionPaymentReceivedEmail({ tenantName: 'Chloe', amount: '89,00 €', method: 'Virement', paidOn: '28 octobre 2026', paidUntil: '30 novembre 2026', billingUrl: null });
  expect(receipt.subject).toContain('30 novembre 2026');
  expect(receipt.html).toContain('89,00 €');
});
