import { autoSuspendAt, formatBillingDate, isSuspendedAt, plural, SUSPENSION_WARNING_DAYS, type SubscriptionRow } from './subscriptionRules';

/**
 * Subscription emails to a tenant's staff (type subscription_billing), run
 * hourly by the scheduler:
 *   due_d7 / due_d3 / due_d0 / overdue_d3
 *             around the due date (paid_until), in manual AND automatic mode
 *   d7 / d1   automatic suspension within 7 days / tomorrow or today
 *   suspended the suspension started (manual or automatic), sent once
 * At most one email per run and tenant; the suspension ones win over the due
 * date ones. Each email has a stable idempotency key: the delivery ledger
 * never sends it twice, whatever the scheduler does. The due-date keys carry
 * paid_until, so a payment (which moves paid_until) ends the reminders of the
 * period by itself.
 */

export type DueReminderKind = 'due_d7' | 'due_d3' | 'due_d0' | 'overdue_d3';
export type ReminderKind = DueReminderKind | 'd7' | 'd1' | 'suspended';

export interface ReminderDecision {
  kind: ReminderKind;
  idempotencyKey: string;
  /** Days until the automatic suspension (d7 / d1), 0 otherwise. */
  daysLeft: number;
  /** Automatic suspension date (d7 / d1 / suspended), or the one already scheduled for a due-date reminder; null in manual mode. */
  suspendOn: Date | null;
  /** paid_until of the period the reminder is about. */
  dueOn: Date | null;
  /** Calendar days (UTC) from today to the due date: negative once it has passed. */
  daysToDue: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A suspension older than this is not announced (first run after deploy, long-standing suspensions). */
const SUSPENDED_NOTICE_WINDOW_DAYS = 7;
/** Due-date reminders are not sent before this hour (UTC): never in the middle of the night. */
export const DUE_REMINDER_FIRST_HOUR_UTC = 7;

/**
 * Due-date steps, in calendar days before (positive) or after (negative) the
 * due date. A step stays due during its window, so a scheduler that was down
 * sends only the latest step still relevant, once; past the last window the
 * tenant gets no more automatic reminder for the period.
 */
export const DUE_REMINDER_STEPS: ReadonlyArray<{ kind: DueReminderKind; from: number; to: number }> = [
  { kind: 'due_d7', from: 7, to: 4 },
  { kind: 'due_d3', from: 3, to: 1 },
  { kind: 'due_d0', from: 0, to: -2 },
  { kind: 'overdue_d3', from: -3, to: -10 },
];

/** Lepefy is told about these steps too (payment due today, still unpaid 3 days later). */
export const PLATFORM_ALERT_KINDS: ReadonlyArray<ReminderKind> = ['due_d0', 'overdue_d3'];

function utcDay(at: Date): number {
  return Math.floor(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) / DAY_MS);
}

/** Calendar days (UTC, the convention of the displayed dates) from `now` to `due`. */
export function calendarDaysUntil(due: Date, now: Date): number {
  return utcDay(due) - utcDay(now);
}

/** « dans 7 jours », « demain », « aujourd’hui », « dépassée depuis 3 jours ». */
export function describeDue(daysToDue: number): string {
  if (daysToDue > 1) return `dans ${daysToDue} jours`;
  if (daysToDue === 1) return 'demain';
  if (daysToDue === 0) return 'aujourd’hui';
  return `dépassée depuis ${plural(-daysToDue, 'jour')}`;
}

function dueDateReminder(tenantId: string, row: SubscriptionRow, now: Date): ReminderDecision | null {
  if (!row.paid_until || now.getUTCHours() < DUE_REMINDER_FIRST_HOUR_UTC) return null;
  const dueOn = new Date(row.paid_until);
  const daysToDue = calendarDaysUntil(dueOn, now);
  const step = DUE_REMINDER_STEPS.find((candidate) => daysToDue <= candidate.from && daysToDue >= candidate.to);
  if (!step) return null;
  return {
    kind: step.kind,
    idempotencyKey: `subscription-due:${tenantId}:${dueOn.toISOString()}:${step.kind}`,
    daysLeft: 0,
    suspendOn: autoSuspendAt(row),
    dueOn,
    daysToDue,
  };
}

export function dueSubscriptionReminder(tenantId: string, row: SubscriptionRow, now: Date = new Date()): ReminderDecision | null {
  const verdict = isSuspendedAt(row, now);
  const dueOn = row.paid_until ? new Date(row.paid_until) : null;
  const daysToDue = dueOn ? calendarDaysUntil(dueOn, now) : 0;
  if (verdict.suspended) {
    const since = verdict.by === 'manual' ? (row.suspended_at ? new Date(row.suspended_at) : null) : autoSuspendAt(row);
    if (!since || now.getTime() - since.getTime() > SUSPENDED_NOTICE_WINDOW_DAYS * DAY_MS) return null;
    return { kind: 'suspended', idempotencyKey: `subscription-suspended:${tenantId}:${since.toISOString()}`, daysLeft: 0, suspendOn: since, dueOn, daysToDue };
  }
  const auto = autoSuspendAt(row);
  if (auto) {
    const daysLeft = Math.ceil((auto.getTime() - now.getTime()) / DAY_MS);
    if (daysLeft <= SUSPENSION_WARNING_DAYS) {
      const kind: ReminderKind = daysLeft <= 1 ? 'd1' : 'd7';
      return { kind, idempotencyKey: `subscription-reminder:${tenantId}:${auto.toISOString()}:${kind}`, daysLeft: Math.max(0, daysLeft), suspendOn: auto, dueOn, daysToDue };
    }
  }
  return dueDateReminder(tenantId, row, now);
}

/** Window in which a suspension counts as just started (scheduler runs hourly). */
export const CACHE_INVALIDATION_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * An automatic suspension starts by the clock alone, with no write that could
 * invalidate the storefront cache: the scheduler does it when it sees a
 * suspension that started within the window. Manual suspensions and payments
 * already invalidate in their own request.
 */
export function suspensionJustStarted(row: SubscriptionRow, now: Date = new Date()): boolean {
  const verdict = isSuspendedAt(row, now);
  if (!verdict.suspended) return false;
  const since = verdict.by === 'manual' ? (row.suspended_at ? new Date(row.suspended_at) : null) : autoSuspendAt(row);
  return Boolean(since) && now.getTime() - since!.getTime() <= CACHE_INVALIDATION_WINDOW_MS;
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
  /** Drops the tenant's cached storefront pages (service state + ISR). */
  invalidate?: (tenantId: string) => void;
}

export type ReminderOutcome = 'sent' | 'not_due' | 'no_recipients' | 'failed' | 'cache_invalidated';

export async function runSubscriptionReminders(deps: ReminderDeps, now: Date = new Date()): Promise<Record<ReminderOutcome, number>> {
  const outcomes: Record<ReminderOutcome, number> = { sent: 0, not_due: 0, no_recipients: 0, failed: 0, cache_invalidated: 0 };
  for (const tenant of await deps.listTenants()) {
    if (deps.invalidate && suspensionJustStarted(tenant.row, now)) {
      deps.invalidate(tenant.tenantId);
      outcomes.cache_invalidated += 1;
    }
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
