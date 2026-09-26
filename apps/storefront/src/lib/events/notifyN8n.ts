// Réutilise le canal n8n existant (N8N_WEBHOOK_URL, voir
// api/webhooks/stripe/route.ts — notification "order-confirmed") pour les
// notifications applicatives. Un échec de transport ne doit jamais faire
// échouer une opération métier déjà validée; les callers qui ont besoin de
// savoir si n8n a accepté la requête peuvent utiliser le booléen retourné.
export async function notifyN8n(webhookPath: string, payload: Record<string, unknown>): Promise<boolean> {
  if (!process.env.N8N_WEBHOOK_URL) {
    console.warn(`[events] N8N_WEBHOOK_URL not set — skipping notification ${webhookPath}`);
    return false;
  }

  // Dedicated secret only for the operational digest. Other existing n8n
  // notifications retain their current transport contract.
  const isDailyDigest = webhookPath.replace(/^\/+/, '') === 'webhook/daily-order-digest';
  const digestSecret = process.env.N8N_DAILY_DIGEST_WEBHOOK_SECRET;
  if (isDailyDigest && !digestSecret) {
    console.error('[events] N8N_DAILY_DIGEST_WEBHOOK_SECRET missing — digest not sent');
    return false;
  }

  try {
    const baseUrl = process.env.N8N_WEBHOOK_URL.replace(/\/$/, '');
    const normalizedPath = webhookPath.startsWith('/') ? webhookPath : `/${webhookPath}`;
    // Both https://n8n.example and https://n8n.example/webhook are accepted as base URLs.
    const suffix = baseUrl.endsWith('/webhook') && normalizedPath.startsWith('/webhook/')
      ? normalizedPath.slice('/webhook'.length) : normalizedPath;
    const res = await fetch(`${baseUrl}${suffix}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(isDailyDigest ? { 'X-Lepefy-Webhook-Secret': digestSecret! } : {}),
      },
      body: JSON.stringify(payload),
    });
    console.info(`[events] n8n notification ${normalizedPath} — status:`, res.status);
    return res.ok;
  } catch (err) {
    console.error(`[events] n8n notification ${webhookPath} failed:`, err);
    return false;
  }
}
