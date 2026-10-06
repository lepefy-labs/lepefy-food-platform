import 'server-only';
import { n8nWebhookUrl } from '@/lib/events/notifyN8n';
import { internalSecret, processingMode } from '@/lib/whatsapp/config';
import { whatsappLog } from '@/lib/whatsapp/log';
import { processPendingWhatsAppMessages } from './processing';

/** Webhook n8n qui rappelle POST /api/internal/whatsapp/process (ops/n8n/whatsapp-inbound-dispatch.json). */
export const WHATSAPP_N8N_DISPATCH_PATH = 'webhook/whatsapp-inbound';
export const WHATSAPP_INTERNAL_SECRET_HEADER = 'X-Lepefy-Webhook-Secret';

/**
 * Délègue le traitement des messages persistés. N'échoue jamais : les messages
 * sont déjà en base (processing_status = pending) et le balayage de
 * maintenance les reprend si l'envoi vers n8n ou le traitement inline échoue.
 * Seuls des UUID internes quittent Lepefy (aucun contenu, aucun numéro).
 */
export async function dispatchWhatsAppProcessing(messages: Array<{ messageId: string; tenantId: string }>): Promise<void> {
  if (messages.length === 0) return;
  const messageIds = messages.map((message) => message.messageId);
  const mode = processingMode();

  if (mode === 'n8n') {
    const url = n8nWebhookUrl(WHATSAPP_N8N_DISPATCH_PATH);
    const secret = internalSecret();
    if (url && secret) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [WHATSAPP_INTERNAL_SECRET_HEADER]: secret },
          body: JSON.stringify({ messageIds }),
          signal: AbortSignal.timeout(3000),
          cache: 'no-store',
        });
        whatsappLog('processing_dispatched', { mode, count: messageIds.length, ok: response.ok, status: response.status });
        return;
      } catch {
        whatsappLog('processing_dispatched', { mode, count: messageIds.length, ok: false });
        return;
      }
    }
    whatsappLog('processing_dispatched', { mode, count: messageIds.length, ok: false, reason: 'n8n_not_configured' });
    return;
  }

  try {
    const result = await processPendingWhatsAppMessages({ messageIds });
    whatsappLog('processing_dispatched', { mode, count: messageIds.length, ok: true, done: result.done, skipped: result.skipped, errors: result.errors });
  } catch (error) {
    whatsappLog('processing_failed', { mode, count: messageIds.length, error: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
  }
}
