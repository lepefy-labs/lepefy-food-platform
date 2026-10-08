import type { WhatsAppLogger } from './log';
import type { ProviderFactory } from './provider/credentials';
import { WhatsAppProviderError, type WhatsAppProviderErrorKind } from './provider/types';
import { isWithinServiceWindow, type WhatsAppAuthorType, type WhatsAppChannel, type WhatsAppConversation } from './types';

/**
 * Service de réponse : seul chemin d'envoi d'un message WhatsApp sortant
 * (automatisation, Nala, opérateur). Toujours depuis le numéro du tenant
 * (canal de la conversation), toujours tracé dans whatsapp_messages.
 */

export interface OutboundInsert {
  tenantId: string;
  conversationId: string;
  channelId: string;
  authorType: Exclude<WhatsAppAuthorType, 'customer'>;
  authorAdminId: string | null;
  body: string;
  status: 'pending' | 'failed';
  errorCode?: string | null;
  errorTitle?: string | null;
  metadata: Record<string, string | number | boolean>;
}

export interface OutboundStore {
  insertOutbound(row: OutboundInsert): Promise<string>;
  markSent(tenantId: string, messageId: string, providerMessageId: string): Promise<void>;
  markFailed(tenantId: string, messageId: string, errorCode: string, errorTitle: string): Promise<void>;
  touchConversation(tenantId: string, conversationId: string): Promise<void>;
}

export interface ResponseDeps {
  store: OutboundStore;
  providerFactory: ProviderFactory;
  log: WhatsAppLogger;
  /** Destinataires autorisés quand le tenant est un tenant de test (WHATSAPP_TEST_RECIPIENTS). */
  testAllowList: string[];
  now?: () => number;
}

export type SendOutcome =
  | { ok: true; messageId: string; providerMessageId: string }
  | { ok: false; messageId: string | null; reason: 'empty' | 'outside_window' | 'test_recipient_blocked' | 'provider_error'; errorKind?: WhatsAppProviderErrorKind };

export async function sendConversationText(
  params: {
    channel: WhatsAppChannel;
    conversation: Pick<WhatsAppConversation, 'id' | 'tenant_id' | 'channel_id' | 'wa_id' | 'last_inbound_at'> & { wa_user_id?: string | null };
    body: string;
    authorType: OutboundInsert['authorType'];
    authorAdminId?: string | null;
    isTestTenant: boolean;
    replyTo?: string | null;
    metadata?: OutboundInsert['metadata'];
  },
  deps: ResponseDeps,
): Promise<SendOutcome> {
  const { channel, conversation } = params;
  // Défense en profondeur : la conversation doit appartenir au canal et au tenant du canal.
  if (conversation.channel_id !== channel.id || conversation.tenant_id !== channel.tenant_id) {
    throw new Error('whatsapp_channel_conversation_mismatch');
  }
  const body = params.body.trim().slice(0, 4096);
  if (!body) return { ok: false, messageId: null, reason: 'empty' };
  const now = deps.now?.() ?? Date.now();
  const logFields = { tenantId: channel.tenant_id, conversationId: conversation.id, author: params.authorType };

  // Hors fenêtre de 24 h, Meta refuse le texte libre (un template approuvé est requis).
  if (!isWithinServiceWindow(conversation.last_inbound_at, now)) {
    deps.log('message_send_failed', { ...logFields, reason: 'outside_window' });
    return { ok: false, messageId: null, reason: 'outside_window' };
  }

  const base = {
    tenantId: channel.tenant_id,
    conversationId: conversation.id,
    channelId: channel.id,
    authorType: params.authorType,
    authorAdminId: params.authorType === 'agent' ? params.authorAdminId ?? null : null,
    body,
    metadata: params.metadata ?? {},
  };

  // Tenant de test : jamais de message vers un numéro réel hors liste autorisée
  // (un client identifié seulement par BSUID ne peut pas être vérifié : bloqué).
  if (params.isTestTenant && (!conversation.wa_id || !deps.testAllowList.includes(conversation.wa_id))) {
    const messageId = await deps.store.insertOutbound({ ...base, status: 'failed', errorCode: 'test_blocked', errorTitle: 'Destinataire hors WHATSAPP_TEST_RECIPIENTS (tenant de test).' });
    deps.log('test_recipient_blocked', logFields);
    return { ok: false, messageId, reason: 'test_recipient_blocked' };
  }

  const messageId = await deps.store.insertOutbound({ ...base, status: 'pending' });
  try {
    const provider = deps.providerFactory(channel);
    const result = await provider.sendText({ phone: conversation.wa_id, userId: conversation.wa_user_id ?? null }, body, { replyTo: params.replyTo ?? undefined });
    await deps.store.markSent(channel.tenant_id, messageId, result.providerMessageId);
    await deps.store.touchConversation(channel.tenant_id, conversation.id);
    deps.log('message_sent', { ...logFields, messageId });
    return { ok: true, messageId, providerMessageId: result.providerMessageId };
  } catch (error) {
    const providerError = error instanceof WhatsAppProviderError ? error : new WhatsAppProviderError({ kind: 'unknown' });
    await deps.store.markFailed(channel.tenant_id, messageId, (providerError.code ?? providerError.kind).slice(0, 32), providerError.message.slice(0, 200));
    deps.log('provider_error', { ...logFields, messageId, kind: providerError.kind, code: providerError.code, httpStatus: providerError.httpStatus });
    return { ok: false, messageId, reason: 'provider_error', errorKind: providerError.kind };
  }
}
