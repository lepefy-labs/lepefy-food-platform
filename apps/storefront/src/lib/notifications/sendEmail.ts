import { notifyN8n, type LedgerRequest } from '@/lib/events/notifyN8n';
import { createServiceClient } from '@/lib/supabase/server';
import { getNotificationRecipients, type NotificationTypeKey } from '@/lib/notifications/getNotificationRecipients';
import {
  getTenantNotificationContext,
  type TenantNotificationContext,
} from '@/lib/notifications/getTenantNotificationContext';

/**
 * Generic delivery channel for emails rendered by the application. The
 * transport is EMAIL_TRANSPORT: n8n workflow "Lepefy · Send email" (validates,
 * claims the key, SMTP) or the Brevo API directly (lib/notifications/emailTransport.ts).
 * New notifications should use this instead of a dedicated n8n workflow.
 */
export const SEND_EMAIL_WEBHOOK = '/webhook/send-email';

export interface RenderedEmail {
  subject: string;
  html: string;
  /** Where customer replies should go (e.g. the tenant support address). */
  replyTo?: string | null;
}

/**
 * File attachment accepted by send-email: at most 5, PDF/CSV/XLSX/PNG/JPEG,
 * about 10 MB of base64 in total (validated again by the n8n workflow).
 */
export interface EmailAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}

export interface EmailDelivery extends RenderedEmail {
  notificationType: string;
  /** Stable per logical message: a retry with the same key never sends twice. */
  idempotencyKey: string;
  recipients: string[];
  /** Keep attachments out of the delivery ledger (useLedger = false): the payload would store them. */
  attachments?: EmailAttachment[];
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
    ...(delivery.attachments?.length ? { attachments: delivery.attachments } : {}),
  }, ledgerFor(context.tenantId, delivery, useLedger)];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * useLedger: recorded and retried. Otherwise the caller owns dedup/retry and
 * the email is still recorded for the admin history ("log" mode), except for
 * platform emails without a tenant.
 */
function ledgerFor(tenantId: string, delivery: EmailDelivery, useLedger: boolean): LedgerRequest | undefined {
  if (!UUID.test(tenantId)) return undefined;
  return {
    tenantId,
    idempotencyKey: delivery.idempotencyKey,
    notificationType: delivery.notificationType,
    mode: useLedger ? 'retry' : 'log',
  };
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
  recipientFlag?: NotificationTypeKey;
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
