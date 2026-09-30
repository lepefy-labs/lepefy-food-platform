import { RENDERED_EMAIL_WEBHOOKS } from '@/lib/notifications/emailTransport';

/**
 * Decisione pura (senza I/O) per una notifica di un tenant di test
 * (tenants.is_test, migration 138), applicata da sendNotification():
 * - email renderizzata → inviata solo ai destinatari di test, oggetto prefissato;
 *   saltata se nessun destinatario di test è configurato;
 * - qualsiasi altro webhook n8n → saltato.
 */
export type TestTenantDecision =
  | { action: 'send'; payload: Record<string, unknown> }
  | { action: 'skip'; channel: string; reason: string };

const TEST_SUBJECT_PREFIX = '[TEST] ';
const MAX_RECIPIENTS = 20;

export function decideTestTenantDelivery(
  webhookPath: string,
  payload: Record<string, unknown>,
  testRecipients: string[],
): TestTenantDecision {
  if (!RENDERED_EMAIL_WEBHOOKS.has(webhookPath)) {
    return { action: 'skip', channel: `n8n ${webhookPath}`, reason: 'external webhook disabled for test tenant' };
  }
  if (!testRecipients.length) {
    return { action: 'skip', channel: `email ${webhookPath}`, reason: 'TEST_TENANT_EMAIL_RECIPIENT not set' };
  }
  const subject = typeof payload.subject === 'string' && !payload.subject.startsWith(TEST_SUBJECT_PREFIX)
    ? `${TEST_SUBJECT_PREFIX}${payload.subject}`
    : payload.subject;
  return {
    action: 'send',
    payload: { ...payload, recipients: testRecipients.slice(0, MAX_RECIPIENTS), subject },
  };
}
