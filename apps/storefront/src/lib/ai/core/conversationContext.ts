import 'server-only';
import { randomUUID } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { AiContextError, type AiMessage } from './types';
import { emptyMemory, type WorkingMemory } from './contextPackage';

export interface ConversationContext {
  id: string; lease: string; tenantId: string; consumer: string;
  memory: WorkingMemory; summary: string | null; turns: AiMessage[];
}
export async function openConversation(params: {
  tenantId: string; consumer: string; conversationId: unknown; locale: string;
}): Promise<ConversationContext> {
  try {
    const id = typeof params.conversationId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.conversationId)
      ? params.conversationId : null;
    const lease = randomUUID();
    const db = createServiceClient();
    const { data, error } = await db.rpc('open_ai_conversation', {
      p_tenant_id: params.tenantId, p_consumer: params.consumer, p_conversation_id: id,
      p_locale: params.locale, p_lease: lease,
    });
    if (error || !data) throw new AiContextError('conversation_unavailable');
    const conversationId = String(data);
    const [state, turns] = await Promise.all([
      db.from('ai_conversation_state').select('working_memory, rolling_summary').eq('conversation_id', conversationId).single(),
      db.from('ai_conversation_turns').select('role, content, sequence').eq('conversation_id', conversationId)
        .order('sequence', { ascending: false }).limit(10),
    ]);
    if (state.error || turns.error) {
      await db.from('ai_conversations').update({ lease_id: null, lease_expires_at: null })
        .eq('id', conversationId).eq('tenant_id', params.tenantId).eq('lease_id', lease);
      throw new AiContextError('conversation_load_failed');
    }
    return { id: conversationId, lease, tenantId: params.tenantId, consumer: params.consumer,
      memory: { ...emptyMemory(params.locale), ...state.data.working_memory, locale: params.locale },
      summary: state.data.rolling_summary,
      turns: (turns.data ?? []).reverse().filter(t => t.role === 'user' || t.role === 'assistant')
        .map(t => ({ role: t.role as AiMessage['role'], content: String(t.content) })) };
  } catch (error) {
    if (error instanceof AiContextError) throw error;
    throw new AiContextError('conversation_unavailable');
  }
}
export async function finishConversation(context: ConversationContext, params: {
  message: string; reply: string; memory: WorkingMemory; provider: string | null; model: string | null;
  confidence: number | null; commerceMode: string;
}) {
  try {
    const { error } = await createServiceClient().rpc('finish_ai_conversation', {
      p_tenant_id: context.tenantId, p_conversation_id: context.id, p_lease: context.lease,
      p_message: params.message, p_reply: params.reply, p_memory: params.memory,
      p_provider: params.provider, p_model: params.model, p_confidence: params.confidence,
      p_commerce_mode: params.commerceMode,
    });
    if (error) throw new AiContextError('conversation_write_failed');
  } catch {
    throw new AiContextError('conversation_write_failed');
  }
}
export async function releaseConversation(context: ConversationContext | null) {
  if (!context) return;
  await createServiceClient().from('ai_conversations').update({ lease_id: null, lease_expires_at: null })
    .eq('id', context.id).eq('tenant_id', context.tenantId).eq('lease_id', context.lease);
}
