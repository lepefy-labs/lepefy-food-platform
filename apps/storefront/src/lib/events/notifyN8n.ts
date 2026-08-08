// Réutilise le canal n8n existant (N8N_WEBHOOK_URL, voir
// api/webhooks/stripe/route.ts — notification "order-confirmed") pour les
// notifications admin du module Événementiel. Confort uniquement : un échec
// ici ne doit jamais faire échouer la réservation/le devis déjà enregistré.
export async function notifyN8n(webhookPath: string, payload: Record<string, unknown>): Promise<void> {
  if (!process.env.N8N_WEBHOOK_URL) {
    console.warn(`[events] N8N_WEBHOOK_URL not set — skipping notification ${webhookPath}`);
    return;
  }

  try {
    const res = await fetch(`${process.env.N8N_WEBHOOK_URL}${webhookPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.info(`[events] n8n notification ${webhookPath} — status:`, res.status);
  } catch (err) {
    console.error(`[events] n8n notification ${webhookPath} failed:`, err);
  }
}
