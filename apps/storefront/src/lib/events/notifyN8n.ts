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

  try {
    const baseUrl = process.env.N8N_WEBHOOK_URL.replace(/\/$/, '');
    const normalizedPath = webhookPath.startsWith('/') ? webhookPath : `/${webhookPath}`;
    const res = await fetch(`${baseUrl}${normalizedPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.info(`[events] n8n notification ${normalizedPath} — status:`, res.status);
    return res.ok;
  } catch (err) {
    console.error(`[events] n8n notification ${webhookPath} failed:`, err);
    return false;
  }
}
