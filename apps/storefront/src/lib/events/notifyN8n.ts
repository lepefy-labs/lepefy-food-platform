// Réutilise le canal n8n existant (N8N_WEBHOOK_URL, voir
// api/webhooks/stripe/route.ts — notification "order-confirmed") pour les
// notifications applicatives. Un échec de transport ne doit jamais faire
// échouer une opération métier déjà validée; les callers qui ont besoin de
// savoir si n8n a accepté la requête peuvent utiliser le booléen retourné.
// Les emails déjà rendus peuvent partir directement par Brevo
// (EMAIL_TRANSPORT=brevo, voir lib/notifications/emailTransport.ts).

import {
  configuredEmailTransport,
  RENDERED_EMAIL_WEBHOOKS,
  sendViaBrevo,
  type TransportResult,
} from '@/lib/notifications/emailTransport';
// Import statiques (pas de import() dynamique) : chargés via le même transform partout, y compris Node 20 en CI.
import { isTestTenantNotification, logTestTenantSkip, testTenantEmailRecipients } from '@/lib/tenant/testTenant';
import { decideTestTenantDelivery } from '@/lib/notifications/testTenantGuard';

export const N8N_WEBHOOK_SECRET_HEADER = 'X-Lepefy-Webhook-Secret';

function isDailyDigestPath(webhookPath: string) {
  return webhookPath.replace(/^\/+/, '') === 'webhook/daily-order-digest';
}

/** Full URL of an n8n webhook; accepts both https://n8n.example and https://n8n.example/webhook as base. */
export function n8nWebhookUrl(webhookPath: string): string | null {
  if (!process.env.N8N_WEBHOOK_URL) return null;
  const baseUrl = process.env.N8N_WEBHOOK_URL.replace(/\/$/, '');
  const normalizedPath = webhookPath.startsWith('/') ? webhookPath : `/${webhookPath}`;
  const suffix = baseUrl.endsWith('/webhook') && normalizedPath.startsWith('/webhook/')
    ? normalizedPath.slice('/webhook'.length) : normalizedPath;
  return `${baseUrl}${suffix}`;
}

/**
 * Authentication header for an n8n webhook. The daily digest keeps its own
 * dedicated secret; every other notification shares
 * N8N_NOTIFICATION_WEBHOOK_SECRET. Returns null when the digest secret is
 * missing (the digest fails closed). Other notifications are sent without the
 * header while the shared secret is not configured (transition only).
 */
export function n8nWebhookHeaders(webhookPath: string): Record<string, string> | null {
  if (isDailyDigestPath(webhookPath)) {
    const digestSecret = process.env.N8N_DAILY_DIGEST_WEBHOOK_SECRET;
    return digestSecret ? { [N8N_WEBHOOK_SECRET_HEADER]: digestSecret } : null;
  }
  const secret = process.env.N8N_NOTIFICATION_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[events] N8N_NOTIFICATION_WEBHOOK_SECRET not set — n8n webhook called without authentication');
    return {};
  }
  return { [N8N_WEBHOOK_SECRET_HEADER]: secret };
}

export interface LedgerRequest {
  tenantId: string;
  idempotencyKey: string;
  notificationType: string;
  /**
   * 'retry' (default): recorded, sent once, retried by the scheduler on failure.
   * 'log': recorded for the admin history only (no payload kept, no retry), for
   * flows that already own their dedup/retry state.
   */
  mode?: 'retry' | 'log';
}

/**
 * With `ledger`, the notification is recorded in notification_deliveries (see
 * LedgerRequest.mode). Without it, a single direct attempt.
 */
export async function notifyN8n(
  webhookPath: string,
  payload: Record<string, unknown>,
  ledger?: LedgerRequest,
): Promise<boolean> {
  if (ledger) {
    const { sendWithLedger } = await import('@/lib/notifications/deliveryLedger');
    return sendWithLedger(webhookPath, payload, ledger, sendNotification);
  }
  return (await sendNotification(webhookPath, payload)).ok;
}

/** One direct attempt; true only when the transport accepted the notification. */
export async function postToN8n(webhookPath: string, payload: Record<string, unknown>): Promise<boolean> {
  return (await sendNotification(webhookPath, payload)).ok;
}

/**
 * One attempt through the configured transport: rendered emails go to Brevo
 * when EMAIL_TRANSPORT=brevo, everything else (and every email by default)
 * goes to its n8n webhook.
 */
export async function sendNotification(webhookPath: string, rawPayload: Record<string, unknown>): Promise<TransportResult> {
  // Tenant di test (tenants.is_test): mai verso clienti reali.
  let payload = rawPayload;
  if (await isTestTenantNotification(payload)) {
    const decision = decideTestTenantDelivery(webhookPath, payload, testTenantEmailRecipients());
    if (decision.action === 'skip') {
      logTestTenantSkip(decision.channel, decision.reason);
      return { ok: true, transport: RENDERED_EMAIL_WEBHOOKS.has(webhookPath) ? configuredEmailTransport() : 'n8n', skipped: true };
    }
    payload = decision.payload;
  }

  if (RENDERED_EMAIL_WEBHOOKS.has(webhookPath) && configuredEmailTransport() === 'brevo') {
    const result = await sendViaBrevo(payload);
    if (result.ok) console.info(`[email] brevo accepted ${String(payload.notificationType ?? webhookPath)} — message:`, result.messageId);
    else console.error(`[email] brevo rejected ${String(payload.notificationType ?? webhookPath)} —`, result.error);
    return result;
  }

  const url = n8nWebhookUrl(webhookPath);
  if (!url) {
    console.warn(`[events] N8N_WEBHOOK_URL not set — skipping notification ${webhookPath}`);
    return { ok: false, transport: 'n8n', error: 'n8n_not_configured' };
  }

  const authHeaders = n8nWebhookHeaders(webhookPath);
  if (!authHeaders) {
    console.error('[events] N8N_DAILY_DIGEST_WEBHOOK_SECRET missing — digest not sent');
    return { ok: false, transport: 'n8n', error: 'n8n_secret_missing' };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(payload),
    });
    console.info(`[events] n8n notification ${webhookPath} — status:`, res.status);
    return res.ok
      ? { ok: true, transport: 'n8n', httpStatus: res.status }
      : { ok: false, transport: 'n8n', httpStatus: res.status, error: `n8n_http_${res.status}` };
  } catch (err) {
    console.error(`[events] n8n notification ${webhookPath} failed:`, err);
    return { ok: false, transport: 'n8n', error: `n8n_network_error ${err instanceof Error ? err.message : ''}`.trim().slice(0, 500) };
  }
}
