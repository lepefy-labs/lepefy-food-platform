/** Lignes des tables de la migration 147 (lecture service role uniquement). */

export type WhatsAppChannelStatus = 'pending' | 'active' | 'disabled';
export type WhatsAppConversationStatus = 'open' | 'automated' | 'waiting_human' | 'human' | 'closed';
export type WhatsAppAutomationStatus = 'active' | 'paused';
export type WhatsAppAuthorType = 'customer' | 'automation' | 'nala' | 'agent' | 'system';
export type WhatsAppMessageStatus = 'received' | 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export const HANDOFF_REASONS = [
  'customer_request', 'complaint', 'payment_issue', 'order_not_received',
  'automation_error', 'low_confidence', 'unsupported_intent', 'agent_takeover', 'media_message',
] as const;
export type WhatsAppHandoffReason = (typeof HANDOFF_REASONS)[number];

export interface WhatsAppChannel {
  id: string;
  tenant_id: string;
  provider: 'meta_cloud';
  environment: 'test' | 'production';
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  status: WhatsAppChannelStatus;
  automation_enabled: boolean;
  ai_enabled: boolean;
  human_handoff_enabled: boolean;
  default_language: string;
  timezone: string;
  auto_resume_minutes: number | null;
  access_token_env: string | null;
  created_at: string;
  updated_at: string;
}

export const CHANNEL_COLUMNS = 'id, tenant_id, provider, environment, waba_id, phone_number_id, display_phone_number, verified_name, status, automation_enabled, ai_enabled, human_handoff_enabled, default_language, timezone, auto_resume_minutes, access_token_env, created_at, updated_at';

export interface WhatsAppConversation {
  id: string;
  tenant_id: string;
  channel_id: string;
  customer_id: string | null;
  /** Numéro WhatsApp (chiffres) — absent pour un client à username sans numéro disponible (migration 148). */
  wa_id: string | null;
  /** Business-scoped user ID Meta (BSUID) — migration 148. */
  wa_user_id: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  status: WhatsAppConversationStatus;
  automation_status: WhatsAppAutomationStatus;
  assigned_to: string | null;
  detected_language: string | null;
  nala_conversation_id: string | null;
  unread_count: number;
  last_message_at: string;
  last_inbound_at: string | null;
  human_handoff_at: string | null;
  automation_resume_at: string | null;
  created_at: string;
}

export const CONVERSATION_COLUMNS = 'id, tenant_id, channel_id, customer_id, wa_id, wa_user_id, customer_phone, customer_name, status, automation_status, assigned_to, detected_language, nala_conversation_id, unread_count, last_message_at, last_inbound_at, human_handoff_at, automation_resume_at, created_at';

export interface WhatsAppMessage {
  id: string;
  tenant_id: string;
  conversation_id: string;
  channel_id: string;
  provider_message_id: string | null;
  direction: 'inbound' | 'outbound';
  author_type: WhatsAppAuthorType;
  author_admin_id: string | null;
  message_type: string;
  body: string | null;
  status: WhatsAppMessageStatus;
  processing_status: 'pending' | 'processing' | 'done' | 'skipped' | 'failed' | null;
  processing_result: string | null;
  error_code: string | null;
  error_title: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
}

export const MESSAGE_COLUMNS = 'id, tenant_id, conversation_id, channel_id, provider_message_id, direction, author_type, author_admin_id, message_type, body, status, processing_status, processing_result, error_code, error_title, metadata, created_at, sent_at, delivered_at, read_at, failed_at';

/** Fenêtre de service client Meta : réponse libre uniquement dans les 24 h suivant le dernier message client. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinServiceWindow(lastInboundAt: string | null, now = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const at = Date.parse(lastInboundAt);
  return Number.isFinite(at) && now - at < CUSTOMER_SERVICE_WINDOW_MS;
}
