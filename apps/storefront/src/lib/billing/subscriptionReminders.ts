import { autoSuspendAt, formatBillingDate, isSuspendedAt, SUSPENSION_WARNING_DAYS, type SubscriptionRow } from './subscriptionRules';

/**
 * Daily subscription emails to a tenant's staff (type subscription_billing):
 *   d7        automatic suspension within 7 days
 *   d1        automatic suspension tomorrow or today
 *   suspended the suspension started (manual or automatic), sent once
 * Each email has a stable idempotency key (tenant + suspension date + kind):
 * the delivery ledger never sends it twice, whatever the scheduler does.
 * Manual mode without a suspension sends nothing (no automatic deadline).
 */

export type ReminderKind = 'd7' | 'd1' | 'suspended';

export interface ReminderDecision {
  kind: ReminderKind;
  idempotencyKey: string;
  daysLeft: number;
  suspendOn: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A suspension older than this is not announced (first run after deploy, long-standing suspensions). */
const SUSPENDED_NOTICE_WINDOW_DAYS = 7;

export function dueSubscriptionReminder(tenantId: string, row: SubscriptionRow, now: Date = new Date()): ReminderDecision | null {
  const verdict = isSuspendedAt(row, now);
  if (verdict.suspended) {
    const since = verdict.by === 'manual' ? (row.suspended_at ? new Date(row.suspended_at) : null) : autoSuspendAt(row);
    if (!since || now.getTime() - since.getTime() > SUSPENDED_NOTICE_WINDOW_DAYS * DAY_MS) return null;
    return { kind: 'suspended', idempotencyKey: `subscription-suspended:${tenantId}:${since.toISOString()}`, daysLeft: 0, suspendOn: since };
  }
  const auto = autoSuspendAt(row);
  if (!auto) return null;
  const daysLeft = Math.ceil((auto.getTime() - now.getTime()) / DAY_MS);
  if (daysLeft > SUSPENSION_WARNING_DAYS) return null;
  const kind: ReminderKind = daysLeft <= 1 ? 'd1' : 'd7';
  return { kind, idempotencyKey: `subscription-reminder:${tenantId}:${auto.toISOString()}:${kind}`, daysLeft: Math.max(0, daysLeft), suspendOn: auto };
}

export interface ReminderTenant {
  tenantId: string;
  row: SubscriptionRow;
}

export interface ReminderDeps {
  listTenants: () => Promise<ReminderTenant[]>;
  /** Subscribed recipients, falling back to the tenant's active administrators. */
  recipients: (tenantId: string) => Promise<string[]>;
  /** Sends one email; true when accepted by the transport (the ledger dedups). */
  send: (tenantId: string, decision: ReminderDecision, recipients: string[], row: SubscriptionRow) => Promise<boolean>;
}

export type ReminderOutcome = 'sent' | 'not_due' | 'no_recipients' | 'failed';

export async function runSubscriptionReminders(deps: ReminderDeps, now: Date = new Date()): Promise<Record<ReminderOutcome, number>> {
  const outcomes: Record<ReminderOutcome, number> = { sent: 0, not_due: 0, no_recipients: 0, failed: 0 };
  for (const tenant of await deps.listTenants()) {
    const decision = dueSubscriptionReminder(tenant.tenantId, tenant.row, now);
    if (!decision) { outcomes.not_due += 1; continue; }
    try {
      const recipients = await deps.recipients(tenant.tenantId);
      if (recipients.length === 0) { outcomes.no_recipients += 1; continue; }
      outcomes[(await deps.send(tenant.tenantId, decision, recipients, tenant.row)) ? 'sent' : 'failed'] += 1;
    } catch (error) {
      console.error('[subscription reminders] tenant failed', tenant.tenantId, error);
      outcomes.failed += 1;
    }
  }
  return outcomes;
}

export function reminderDates(decision: ReminderDecision, row: SubscriptionRow) {
  return { suspendOn: formatBillingDate(decision.suspendOn), paidUntil: formatBillingDate(row.paid_until) };
}
