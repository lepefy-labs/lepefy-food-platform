import { z } from 'zod';
import { MODULE_KEYS } from './subscriptionRules';

/** Body of POST /api/admin/platform/subscriptions/[tenantId]. */
const reason = z.string().trim().min(3, 'Indiquez un motif (3 caractères minimum).').max(500);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.');

export const platformSubscriptionActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('record_transfer'),
    amountEur: z.number().finite().min(0).max(100000),
    paidOn: isoDate,
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('suspend'), reason }),
  z.object({ action: z.literal('reactivate'), reason }),
  z.object({ action: z.literal('set_paid_until'), paidUntil: isoDate, reason }),
  z.object({ action: z.literal('set_payment_link'), url: z.string().trim().url().startsWith('https://').nullable(), reason }),
  z.object({
    action: z.literal('set_suspension_policy'),
    mode: z.enum(['manual', 'automatic']),
    graceDays: z.number().int().min(0).max(365),
    reason,
  }),
  z.object({ action: z.literal('suspend_module'), module: z.enum(MODULE_KEYS), reason }),
  z.object({ action: z.literal('reactivate_module'), module: z.enum(MODULE_KEYS), reason }),
]);

export type PlatformSubscriptionAction = z.infer<typeof platformSubscriptionActionSchema>;

/** A calendar date entered by the platform → the last second (UTC) of that day. */
export function endOfDayUtc(date: string): string {
  return `${date}T23:59:59.000Z`;
}

/** A transfer value date → midday UTC (never "in the future" because of a timezone). */
export function transferPaidAt(date: string, now: Date = new Date()): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  return (value.getTime() > now.getTime() ? now : value).toISOString();
}
