// Réutilise le canal n8n existant (N8N_WEBHOOK_URL, voir
// api/webhooks/stripe/route.ts — notification "order-confirmed") pour les
// notifications applicatives. Un échec de transport ne doit jamais faire
// échouer une opération métier déjà validée; les callers qui ont besoin de
// savoir si n8n a accepté la requête peuvent utiliser le booléen retourné.

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

export async function notifyN8n(webhookPath: string, payload: Record<string, unknown>): Promise<boolean> {
  const url = n8nWebhookUrl(webhookPath);
  if (!url) {
    console.warn(`[events] N8N_WEBHOOK_URL not set — skipping notification ${webhookPath}`);
    return false;
  }

  const authHeaders = n8nWebhookHeaders(webhookPath);
  if (!authHeaders) {
    console.error('[events] N8N_DAILY_DIGEST_WEBHOOK_SECRET missing — digest not sent');
    return false;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(payload),
    });
    console.info(`[events] n8n notification ${webhookPath} — status:`, res.status);
    return res.ok;
  } catch (err) {
    console.error(`[events] n8n notification ${webhookPath} failed:`, err);
    return false;
  }
}
