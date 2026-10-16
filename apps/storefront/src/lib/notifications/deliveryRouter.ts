import { sendNotification } from '@/lib/events/notifyN8n';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { isTestTenantId } from '@/lib/tenant/testTenant';
import { testRecipientAllowList } from '@/lib/whatsapp/config';
import type { DeliveryOutcome } from '@/lib/notifications/deliveryLedger';
import { GREEN_API_DELIVERY_PATH, readGreenApiOutboundConfig, sendGreenApiText } from '@/lib/notifications/providers/greenApiOutbound';
import { STAFF_WHATSAPP_FLAG } from '@/lib/notifications/staff/staffWhatsapp';

/**
 * One send for any ledger row: WhatsApp rows go to Green API, everything else
 * keeps the email/n8n transport (sendNotification). Used by the dispatcher,
 * the retry scheduler and the platform « Réessayer ».
 */
export async function routeDelivery(webhookPath: string, payload: Record<string, unknown>): Promise<DeliveryOutcome> {
  if (webhookPath !== GREEN_API_DELIVERY_PATH) return sendNotification(webhookPath, payload);
  return sendWhatsappPayload(payload);
}

export interface WhatsappPayload {
  tenantId: string;
  to: string;
  message: string;
  test?: boolean;
}

export function parseWhatsappPayload(payload: Record<string, unknown>): WhatsappPayload | null {
  const { tenantId, to, message, test } = payload as Record<string, unknown>;
  if (typeof tenantId !== 'string' || typeof to !== 'string' || typeof message !== 'string') return null;
  return { tenantId, to, message, test: test === true };
}

async function sendWhatsappPayload(raw: Record<string, unknown>): Promise<DeliveryOutcome> {
  const payload = parseWhatsappPayload(raw);
  if (!payload) return { ok: false, transport: 'green_api', definitive: true, error: 'invalid_payload' };
  // Kill switch checked again at send time: turning the flag off stops the queue.
  if (!payload.test && !(await isFeatureEnabled(payload.tenantId, STAFF_WHATSAPP_FLAG))) {
    return { ok: true, skipped: true, transport: 'green_api', error: 'whatsapp_disabled' };
  }
  if (await isTestTenantId(payload.tenantId).catch(() => false)) {
    const allowed = testRecipientAllowList();
    if (!allowed.includes(payload.to.replace(/\D/g, ''))) {
      console.info('[whatsapp-notify] test tenant — recipient outside WHATSAPP_TEST_RECIPIENTS, skipped');
      return { ok: true, skipped: true, transport: 'green_api', error: 'test_tenant_recipient_not_allowed' };
    }
  }
  const config = readGreenApiOutboundConfig();
  if (!config.ok) {
    console.error('[whatsapp-notify] Green API not configured —', config.reason, config.detail);
    return { ok: false, transport: 'green_api', error: 'green_api_not_configured' };
  }
  const result = await sendGreenApiText(config.config, { phone: payload.to, message: payload.message });
  if (result.ok) console.info('[whatsapp-notify] accepted — message:', result.messageId);
  else console.warn('[whatsapp-notify] not accepted —', result.error, result.uncertain ? '(uncertain)' : '');
  return result;
}
