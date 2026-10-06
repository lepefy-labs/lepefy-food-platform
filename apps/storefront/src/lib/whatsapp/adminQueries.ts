import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CHANNEL_COLUMNS, CONVERSATION_COLUMNS, MESSAGE_COLUMNS,
  type WhatsAppChannel, type WhatsAppConversation, type WhatsAppMessage,
} from './types';

/**
 * Lectures admin du canal WhatsApp. Le tenantId vient TOUJOURS du serveur
 * (tenant du déploiement, vérifié par requirePermission) et filtre chaque
 * requête : un identifiant de conversation d'un autre tenant renvoie null,
 * exactement comme un identifiant inexistant.
 */

type Db = Pick<SupabaseClient, 'from'>;

export type InboxState = 'nala' | 'automation' | 'needs_human' | 'human' | 'closed' | 'open';

export const INBOX_FILTERS = ['all', 'needs_human', 'human', 'automated', 'closed'] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export function parseInboxFilter(value: unknown): InboxFilter {
  return typeof value === 'string' && (INBOX_FILTERS as readonly string[]).includes(value) ? value as InboxFilter : 'all';
}

export function inboxState(conversation: Pick<WhatsAppConversation, 'status'>, lastOutboundAuthor: string | null): InboxState {
  switch (conversation.status) {
    case 'waiting_human': return 'needs_human';
    case 'human': return 'human';
    case 'closed': return 'closed';
    case 'automated': return lastOutboundAuthor === 'nala' ? 'nala' : 'automation';
    default: return 'open';
  }
}

export interface InboxItem {
  id: string;
  customerName: string | null;
  customerPhone: string;
  customerLinked: boolean;
  state: InboxState;
  automationPaused: boolean;
  unreadCount: number;
  lastMessageAt: string;
  assignedTo: string | null;
  preview: { text: string; direction: 'inbound' | 'outbound'; author: string } | null;
}

function preview(message: Pick<WhatsAppMessage, 'body' | 'message_type' | 'direction' | 'author_type'> | undefined): InboxItem['preview'] {
  if (!message) return null;
  const text = message.body?.replace(/\s+/g, ' ').trim().slice(0, 120) || `[${message.message_type}]`;
  return { text, direction: message.direction, author: message.author_type };
}

export async function loadLiveChannel(db: Db, tenantId: string): Promise<WhatsAppChannel | null> {
  const { data, error } = await db.from('tenant_whatsapp_channels').select(CHANNEL_COLUMNS)
    .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(10);
  if (error) throw new Error('whatsapp_channel_read_failed');
  const rows = (data ?? []) as unknown as WhatsAppChannel[];
  return rows.find((row) => row.tenant_id === tenantId && row.status !== 'disabled') ?? rows.find((row) => row.tenant_id === tenantId) ?? null;
}

export async function listInbox(db: Db, tenantId: string, filter: InboxFilter, limit = 50): Promise<InboxItem[]> {
  let query = db.from('whatsapp_conversations').select(CONVERSATION_COLUMNS).eq('tenant_id', tenantId);
  if (filter === 'needs_human') query = query.eq('status', 'waiting_human');
  else if (filter === 'human') query = query.eq('status', 'human');
  else if (filter === 'automated') query = query.in('status', ['automated', 'open']);
  else if (filter === 'closed') query = query.eq('status', 'closed');
  const { data, error } = await query.order('last_message_at', { ascending: false }).limit(limit);
  if (error) throw new Error('whatsapp_inbox_read_failed');
  const conversations = ((data ?? []) as unknown as WhatsAppConversation[]).filter((row) => row.tenant_id === tenantId);
  if (conversations.length === 0) return [];

  const { data: messages, error: messagesError } = await db.from('whatsapp_messages')
    .select('conversation_id, tenant_id, body, message_type, direction, author_type, created_at')
    .eq('tenant_id', tenantId).in('conversation_id', conversations.map((row) => row.id))
    .order('created_at', { ascending: false }).limit(conversations.length * 8);
  if (messagesError) throw new Error('whatsapp_inbox_read_failed');
  const last = new Map<string, WhatsAppMessage>();
  const lastOutbound = new Map<string, string>();
  const sorted = ((messages ?? []) as unknown as WhatsAppMessage[])
    .filter((row) => row.tenant_id === tenantId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const message of sorted) {
    if (!last.has(message.conversation_id)) last.set(message.conversation_id, message);
    if (message.direction === 'outbound' && !lastOutbound.has(message.conversation_id)) lastOutbound.set(message.conversation_id, message.author_type);
  }

  return conversations.map((conversation) => ({
    id: conversation.id,
    customerName: conversation.customer_name,
    customerPhone: conversation.customer_phone,
    customerLinked: Boolean(conversation.customer_id),
    state: inboxState(conversation, lastOutbound.get(conversation.id) ?? null),
    automationPaused: conversation.automation_status === 'paused',
    unreadCount: conversation.unread_count,
    lastMessageAt: conversation.last_message_at,
    assignedTo: conversation.assigned_to,
    preview: preview(last.get(conversation.id)),
  }));
}

export interface ConversationDetail {
  conversation: WhatsAppConversation;
  state: InboxState;
  messages: Array<Pick<WhatsAppMessage, 'id' | 'direction' | 'author_type' | 'message_type' | 'body' | 'status' | 'error_code' | 'error_title' | 'created_at' | 'processing_result'>>;
  openHandoff: { reason: string; requested_at: string; assigned_to: string | null } | null;
  customer: { id: string; name: string | null } | null;
  withinServiceWindow: boolean;
}

export async function loadConversationDetail(db: Db, tenantId: string, conversationId: string, now = Date.now()): Promise<ConversationDetail | null> {
  const { data, error } = await db.from('whatsapp_conversations').select(CONVERSATION_COLUMNS)
    .eq('tenant_id', tenantId).eq('id', conversationId).maybeSingle();
  if (error) throw new Error('whatsapp_conversation_read_failed');
  const conversation = data as unknown as WhatsAppConversation | null;
  if (!conversation || conversation.tenant_id !== tenantId) return null;

  const [messagesResult, handoffResult, customerResult] = await Promise.all([
    db.from('whatsapp_messages').select(MESSAGE_COLUMNS)
      .eq('tenant_id', tenantId).eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(200),
    db.from('whatsapp_handoffs').select('reason, requested_at, assigned_to, tenant_id')
      .eq('tenant_id', tenantId).eq('conversation_id', conversationId).is('resolved_at', null).maybeSingle(),
    conversation.customer_id
      ? db.from('customers').select('id, full_name, tenant_id').eq('tenant_id', tenantId).eq('id', conversation.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (messagesResult.error) throw new Error('whatsapp_messages_read_failed');
  const messages = ((messagesResult.data ?? []) as unknown as WhatsAppMessage[])
    .filter((row) => row.tenant_id === tenantId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lastOutbound = [...messages].reverse().find((message) => message.direction === 'outbound')?.author_type ?? null;
  const customer = customerResult.data as { id: string; full_name: string | null } | null;
  const lastInbound = conversation.last_inbound_at ? Date.parse(conversation.last_inbound_at) : NaN;

  return {
    conversation,
    state: inboxState(conversation, lastOutbound),
    messages: messages.map((message) => ({
      id: message.id, direction: message.direction, author_type: message.author_type, message_type: message.message_type,
      body: message.body, status: message.status, error_code: message.error_code, error_title: message.error_title,
      created_at: message.created_at, processing_result: message.processing_result,
    })),
    openHandoff: (handoffResult.data as ConversationDetail['openHandoff']) ?? null,
    customer: customer ? { id: customer.id, name: customer.full_name } : null,
    withinServiceWindow: Number.isFinite(lastInbound) && now - lastInbound < 24 * 60 * 60 * 1000,
  };
}
