import { notifyN8n } from '@/lib/events/notifyN8n';
import { createServiceClient } from '@/lib/supabase/server';
import { getNotificationRecipients, type NotificationFlag } from '@/lib/notifications/getNotificationRecipients';
import {
  getTenantNotificationContext,
  type TenantNotificationContext,
} from '@/lib/notifications/getTenantNotificationContext';

/**
 * Generic n8n delivery channel: the application renders the email and n8n
 * only validates, claims the idempotency key and sends it over SMTP
 * (workflow "Lepefy · Send email"). New notifications should use this
 * instead of adding a dedicated n8n workflow with its own template.
 */
export const SEND_EMAIL_WEBHOOK = '/webhook/send-email';

export interface RenderedEmail {
  subject: string;
  html: string;
  /** Where customer replies should go (e.g. the tenant support address). */
  replyTo?: string | null;
}

export interface EmailDelivery extends RenderedEmail {
  notificationType: string;
  /** Stable per logical message: a retry with the same key never sends twice. */
  idempotencyKey: string;
  recipients: string[];
}

export async function deliverEmail(
  context: TenantNotificationContext,
  delivery: EmailDelivery,
  notify: typeof notifyN8n = notifyN8n,
  /** false for callers that keep their own delivery state (marketing recipients). */
  useLedger = true,
): Promise<boolean> {
  if (!delivery.recipients.length) {
    console.warn(`[sendEmail] ${delivery.notificationType} skipped — no recipient — tenant:`, context.tenantId);
    return false;
  }
  return notify(...emailRequest(context, delivery, useLedger));
}

/**
 * Arguments for `notifyN8n` delivering a rendered email through send-email,
 * for callers that receive notifyN8n as an injected dependency.
 */
export function emailRequest(
  context: TenantNotificationContext,
  delivery: EmailDelivery,
  useLedger = true,
): [string, Record<string, unknown>, Parameters<typeof notifyN8n>[2]] {
  return [SEND_EMAIL_WEBHOOK, {
    notificationType: delivery.notificationType,
    tenantId: context.tenantId,
    idempotencyKey: delivery.idempotencyKey,
    recipients: delivery.recipients,
    subject: delivery.subject,
    html: delivery.html,
    replyTo: delivery.replyTo ?? null,
    emailBranding: context.emailBranding,
  }, useLedger
    ? { tenantId: context.tenantId, idempotencyKey: delivery.idempotencyKey, notificationType: delivery.notificationType }
    : undefined];
}

/**
 * Best-effort: resolves the tenant context and, for internal alerts, the
 * opted-in recipients of `recipientFlag`. Never throws; returns whether n8n
 * accepted the email.
 */
export async function sendTenantEmail(input: {
  tenantId: string;
  notificationType: string;
  idempotencyKey: string;
  recipients?: string[];
  recipientFlag?: NotificationFlag;
  render: (context: TenantNotificationContext) => RenderedEmail;
}): Promise<boolean> {
  try {
    const context = await getTenantNotificationContext(input.tenantId);
    if (!context) {
      console.error(`[sendEmail] ${input.notificationType} not sent — tenant context unavailable — tenant:`, input.tenantId);
      return false;
    }
    const recipients = input.recipients
      ?? (input.recipientFlag ? await getNotificationRecipients(createServiceClient(), input.tenantId, input.recipientFlag) : []);
    return await deliverEmail(context, {
      ...input.render(context),
      notificationType: input.notificationType,
      idempotencyKey: input.idempotencyKey,
      recipients,
    });
  } catch (error) {
    console.error(`[sendEmail] ${input.notificationType} failed:`, error);
    return false;
  }
}
