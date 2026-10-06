/**
 * Journal structuré du canal WhatsApp. Une seule forme : `[whatsapp] <event>` +
 * un objet de champs techniques. Ne jamais y passer de corps de message, de
 * numéro client, de nom, de jeton ni de payload brut : seuls des identifiants
 * internes (UUID), des codes et des compteurs.
 */
export type WhatsAppLogEvent =
  | 'webhook_received'
  | 'webhook_rejected'
  | 'tenant_resolved'
  | 'unknown_phone_number_id'
  | 'channel_disabled'
  | 'feature_disabled'
  | 'duplicate_event'
  | 'message_ingested'
  | 'status_applied'
  | 'status_unmatched'
  | 'processing_dispatched'
  | 'processing_failed'
  | 'automation_executed'
  | 'automation_skipped'
  | 'message_sent'
  | 'message_send_failed'
  | 'test_recipient_blocked'
  | 'provider_error'
  | 'handoff_requested'
  | 'handoff_resolved'
  | 'ai_fallback'
  | 'maintenance';

export type WhatsAppLogFields = Record<string, string | number | boolean | null | undefined>;

export type WhatsAppLogger = (event: WhatsAppLogEvent, fields?: WhatsAppLogFields) => void;

const WARN_EVENTS = new Set<WhatsAppLogEvent>([
  'webhook_rejected', 'unknown_phone_number_id', 'processing_failed', 'message_send_failed', 'provider_error',
  'test_recipient_blocked', 'ai_fallback',
]);

export const whatsappLog: WhatsAppLogger = (event, fields = {}) => {
  const line = `[whatsapp] ${event}`;
  if (WARN_EVENTS.has(event)) console.warn(line, fields);
  else console.info(line, fields);
};
