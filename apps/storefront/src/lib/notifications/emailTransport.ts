/**
 * Email transport switch (phase 3).
 *
 * EMAIL_TRANSPORT=n8n (default): rendered emails are posted to the n8n
 * send-email / order-stock-conflict / daily-order-digest webhooks as before.
 * EMAIL_TRANSPORT=brevo: the same payloads are sent directly through the Brevo
 * transactional API (BREVO_API_KEY), with the checks the n8n workflow applied.
 * Every other n8n webhook is unaffected.
 */

export type EmailTransportName = 'n8n' | 'brevo';

export interface TransportResult {
  ok: boolean;
  transport: EmailTransportName;
  /** Brevo message id, to look the email up in Brevo → Transactional → Logs. */
  messageId?: string | null;
  error?: string;
  httpStatus?: number;
  /** Not sent on purpose (test tenant guard, lib/tenant/testTenant.ts). */
  skipped?: boolean;
}

/** n8n webhooks whose payload is a rendered email (recipients, subject, html, emailBranding). */
export const RENDERED_EMAIL_WEBHOOKS = new Set([
  '/webhook/send-email',
  '/webhook/order-stock-conflict',
  '/webhook/daily-order-digest',
]);

export function configuredEmailTransport(): EmailTransportName {
  return process.env.EMAIL_TRANSPORT === 'brevo' ? 'brevo' : 'n8n';
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const ALLOWED_SENDER = /@lepefy\.com$/i;
const ATTACHMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
}

/** Validates a rendered-email payload and maps it to a Brevo request body. */
export function toBrevoMessage(payload: Record<string, unknown>): { body: Record<string, unknown> } | { error: string } {
  const recipients = payload.recipients;
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 20 || !recipients.every(isEmail)) {
    return { error: 'invalid_recipients' };
  }
  const subject = payload.subject;
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 300 || /[\r\n]/.test(subject)) return { error: 'invalid_subject' };
  const html = payload.html;
  if (typeof html !== 'string' || !html.length || html.length > 200_000) return { error: 'invalid_html' };
  const branding = payload.emailBranding as { fromName?: unknown; fromEmail?: unknown } | undefined;
  const fromName = typeof branding?.fromName === 'string' ? branding.fromName.trim() : '';
  if (!fromName || fromName.length > 100 || /[\r\n<>"]/.test(fromName) || !isEmail(branding?.fromEmail)) return { error: 'invalid_sender' };
  if (!ALLOWED_SENDER.test(branding.fromEmail as string)) return { error: 'sender_not_allowed' };
  const replyTo = payload.replyTo;
  if (replyTo != null && replyTo !== '' && !isEmail(replyTo)) return { error: 'invalid_reply_to' };

  const rawAttachments = payload.attachments == null ? [] : payload.attachments;
  if (!Array.isArray(rawAttachments) || rawAttachments.length > 5) return { error: 'invalid_attachments' };
  let total = 0;
  const attachment: Array<{ name: string; content: string }> = [];
  for (const item of rawAttachments as Array<{ filename?: unknown; contentType?: unknown; contentBase64?: unknown }>) {
    const name = typeof item?.filename === 'string' ? item.filename : '';
    const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (!ext || !ATTACHMENT_TYPES[ext] || !/^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,119}$/.test(name)) return { error: 'invalid_attachment_name' };
    if (typeof item.contentType !== 'string' || item.contentType.split(';')[0]!.trim().toLowerCase() !== ATTACHMENT_TYPES[ext]) {
      return { error: 'invalid_attachment_type' };
    }
    if (typeof item.contentBase64 !== 'string' || !item.contentBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.contentBase64)) {
      return { error: 'invalid_attachment_content' };
    }
    total += item.contentBase64.length;
    attachment.push({ name, content: item.contentBase64 });
  }
  if (total > 14_000_000) return { error: 'attachments_too_large' };

  const notificationType = typeof payload.notificationType === 'string' ? payload.notificationType.slice(0, 60) : 'notification';
  const idempotencyKey = typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey.slice(0, 200) : undefined;
  return {
    body: {
      sender: { name: fromName, email: branding.fromEmail },
      to: recipients.map((email: string) => ({ email })),
      subject,
      htmlContent: html,
      ...(isEmail(replyTo) ? { replyTo: { email: replyTo } } : {}),
      ...(attachment.length ? { attachment } : {}),
      tags: [notificationType],
      ...(idempotencyKey ? { headers: { 'X-Lepefy-Idempotency-Key': idempotencyKey } } : {}),
    },
  };
}

/** One Brevo API call; never throws. */
export async function sendViaBrevo(
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<TransportResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, transport: 'brevo', error: 'brevo_api_key_missing' };
  const message = toBrevoMessage(payload);
  if ('error' in message) return { ok: false, transport: 'brevo', error: message.error };
  try {
    const response = await fetchImpl(BREVO_ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(message.body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let json: { messageId?: string; message?: string; code?: string } = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON error body */ }
    if (!response.ok) {
      const detail = [json.code, json.message].filter(Boolean).join(': ') || text.slice(0, 200);
      return { ok: false, transport: 'brevo', httpStatus: response.status, error: `brevo_http_${response.status}${detail ? ` ${detail}` : ''}`.slice(0, 500) };
    }
    return { ok: true, transport: 'brevo', httpStatus: response.status, messageId: json.messageId ?? null };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, transport: 'brevo', error: name === 'TimeoutError' ? 'brevo_timeout' : `brevo_network_error ${error instanceof Error ? error.message : ''}`.trim().slice(0, 500) };
  }
}

export interface BrevoAccountStatus {
  ok: boolean;
  error?: string;
  plans?: Array<{ type: string; credits: number | null; creditsType: string | null }>;
}

/** Read-only Brevo account check (key validity and remaining credits); never throws. */
export async function checkBrevoAccount(fetchImpl: typeof fetch = fetch): Promise<BrevoAccountStatus> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: 'brevo_api_key_missing' };
  try {
    const response = await fetchImpl('https://api.brevo.com/v3/account', {
      headers: { 'api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, error: `brevo_http_${response.status}` };
    const body = await response.json() as { plan?: Array<{ type?: string; credits?: number; creditsType?: string }> };
    return {
      ok: true,
      plans: (body.plan ?? []).map((plan) => ({ type: plan.type ?? 'inconnu', credits: plan.credits ?? null, creditsType: plan.creditsType ?? null })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === 'TimeoutError' ? 'brevo_timeout' : 'brevo_network_error' };
  }
}
