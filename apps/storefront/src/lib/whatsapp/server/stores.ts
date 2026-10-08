import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { WHATSAPP_FEATURE_FLAG } from '@/lib/whatsapp/config';
import type { HandoffStore } from '@/lib/whatsapp/handoff';
import type { IngestionStore } from '@/lib/whatsapp/ingestion';
import type { OutboundStore } from '@/lib/whatsapp/responseService';

/**
 * Implémentations Supabase (service role) des stores du canal WhatsApp.
 * Chaque écriture est filtrée par tenant_id en plus de l'identifiant :
 * aucune opération ne peut toucher la ligne d'un autre tenant, même avec un
 * identifiant deviné.
 */

type Db = SupabaseClient;

function fail(scope: string, error: { code?: string; message?: string } | null): never {
  throw new Error(`whatsapp_${scope}_failed${error?.code ? `:${error.code}` : ''}`);
}

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '');
}

export function createIngestionStore(db: Db): IngestionStore {
  return {
    async findChannelByPhoneNumberId(phoneNumberId) {
      const { data, error } = await db.from('tenant_whatsapp_channels')
        .select('id, tenant_id, status, auto_resume_minutes')
        .eq('provider', 'meta_cloud').eq('phone_number_id', phoneNumberId).maybeSingle();
      if (error) fail('channel_lookup', error);
      return data ? {
        id: data.id as string,
        tenantId: data.tenant_id as string,
        status: data.status as 'pending' | 'active' | 'disabled',
        autoResumeMinutes: (data.auto_resume_minutes as number | null) ?? null,
      } : null;
    },
    isFeatureEnabled: (tenantId) => isFeatureEnabled(tenantId, WHATSAPP_FEATURE_FLAG),
    async ingestInbound(channelId, event) {
      let { data, error } = await db.rpc('ingest_whatsapp_inbound_message', {
        p_channel_id: channelId,
        p_wa_id: event.waId,
        p_customer_name: event.profileName,
        p_provider_message_id: event.providerMessageId,
        p_message_type: event.messageType,
        p_body: event.body,
        p_metadata: event.metadata,
        p_provider_timestamp: event.timestamp?.toISOString() ?? null,
        // Migration 148 : identité BSUID (client avec username, éventuellement sans numéro).
        p_user_id: event.userId,
      });
      // Migration 148 pas encore appliquée : signature 147 (numéro obligatoire).
      if (error && isMissingFunction(error) && event.waId) {
        ({ data, error } = await db.rpc('ingest_whatsapp_inbound_message', {
          p_channel_id: channelId,
          p_wa_id: event.waId,
          p_customer_name: event.profileName,
          p_provider_message_id: event.providerMessageId,
          p_message_type: event.messageType,
          p_body: event.body,
          p_metadata: event.metadata,
          p_provider_timestamp: event.timestamp?.toISOString() ?? null,
        }));
      }
      const row = (Array.isArray(data) ? data[0] : data) as { out_message_id: string; out_conversation_id: string; out_tenant_id: string; out_created: boolean } | null;
      if (error || !row) fail('ingest', error);
      return { messageId: row.out_message_id, conversationId: row.out_conversation_id, tenantId: row.out_tenant_id, created: row.out_created };
    },
    async ingestBusinessEcho(channelId, event, resumeMinutes) {
      const { data, error } = await db.rpc('ingest_whatsapp_business_echo', {
        p_channel_id: channelId,
        p_wa_id: event.waId,
        p_user_id: event.userId,
        p_provider_message_id: event.providerMessageId,
        p_message_type: event.messageType,
        p_body: event.body,
        p_metadata: event.metadata,
        p_provider_timestamp: event.timestamp?.toISOString() ?? null,
        p_resume_minutes: resumeMinutes,
      });
      const row = (Array.isArray(data) ? data[0] : data) as { out_message_id: string; out_conversation_id: string; out_tenant_id: string; out_created: boolean } | null;
      if (error || !row) fail('echo_ingest', error);
      return { messageId: row.out_message_id, conversationId: row.out_conversation_id, tenantId: row.out_tenant_id, created: row.out_created };
    },
    async applyStatus(channelId, event) {
      const { data, error } = await db.rpc('apply_whatsapp_message_status', {
        p_channel_id: channelId,
        p_provider_message_id: event.providerMessageId,
        p_status: event.status,
        p_at: event.timestamp?.toISOString() ?? null,
        p_error_code: event.errorCode,
        p_error_title: event.errorTitle,
      });
      if (error) fail('status', error);
      const row = (Array.isArray(data) ? data[0] : data) as { out_tenant_id: string; out_applied: boolean } | null | undefined;
      return row ? { found: true, applied: row.out_applied, tenantId: row.out_tenant_id } : { found: false, applied: false, tenantId: null };
    },
  };
}

export function createOutboundStore(db: Db): OutboundStore {
  return {
    async insertOutbound(row) {
      const now = new Date().toISOString();
      const { data, error } = await db.from('whatsapp_messages').insert({
        tenant_id: row.tenantId,
        conversation_id: row.conversationId,
        channel_id: row.channelId,
        direction: 'outbound',
        author_type: row.authorType,
        author_admin_id: row.authorAdminId,
        message_type: 'text',
        body: row.body,
        status: row.status,
        error_code: row.errorCode ?? null,
        error_title: row.errorTitle ?? null,
        failed_at: row.status === 'failed' ? now : null,
        metadata: row.metadata,
      }).select('id').single();
      if (error || !data) fail('outbound_insert', error);
      return data.id as string;
    },
    async markSent(tenantId, messageId, providerMessageId) {
      const { error } = await db.from('whatsapp_messages')
        .update({ provider_message_id: providerMessageId, status: 'sent', sent_at: new Date().toISOString() })
        .eq('tenant_id', tenantId).eq('id', messageId).eq('status', 'pending');
      if (error) fail('outbound_sent', error);
    },
    async markFailed(tenantId, messageId, errorCode, errorTitle) {
      const { error } = await db.from('whatsapp_messages')
        .update({ status: 'failed', failed_at: new Date().toISOString(), error_code: errorCode, error_title: errorTitle })
        .eq('tenant_id', tenantId).eq('id', messageId);
      if (error) fail('outbound_failed', error);
    },
    async touchConversation(tenantId, conversationId) {
      const { error } = await db.from('whatsapp_conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('tenant_id', tenantId).eq('id', conversationId);
      if (error) fail('conversation_touch', error);
    },
  };
}

export function createHandoffStore(db: Db): HandoffStore {
  return {
    async openHandoff(row) {
      const { error } = await db.from('whatsapp_handoffs').insert({
        tenant_id: row.tenantId,
        conversation_id: row.conversationId,
        reason: row.reason,
        trigger_message_id: row.triggerMessageId,
        resume_automation_at: row.resumeAt,
        assigned_to: row.assignedTo,
        accepted_at: row.acceptedAt,
      });
      if (!error) return 'created';
      if (error.code === '23505') return 'exists';
      fail('handoff_open', error);
    },
    async acceptOpenHandoff(tenantId, conversationId, adminId, at) {
      const { error } = await db.from('whatsapp_handoffs')
        .update({ assigned_to: adminId, accepted_at: at })
        .eq('tenant_id', tenantId).eq('conversation_id', conversationId).is('resolved_at', null);
      if (error) fail('handoff_accept', error);
    },
    async resolveOpenHandoffs(tenantId, conversationId, resolution, adminId, at) {
      const { data, error } = await db.from('whatsapp_handoffs')
        .update({ resolved_at: at, resolution, resolved_by: adminId })
        .eq('tenant_id', tenantId).eq('conversation_id', conversationId).is('resolved_at', null)
        .select('id');
      if (error) fail('handoff_resolve', error);
      return (data ?? []).length;
    },
    async updateConversation(tenantId, conversationId, patch) {
      const { error } = await db.from('whatsapp_conversations').update(patch)
        .eq('tenant_id', tenantId).eq('id', conversationId);
      if (error) fail('conversation_update', error);
    },
    async audit(event) {
      const { error } = await db.from('whatsapp_audit_events').insert({
        tenant_id: event.tenantId,
        conversation_id: event.conversationId,
        event_type: event.eventType,
        actor_type: event.actorType,
        actor_admin_id: event.actorAdminId,
        detail: event.detail,
      });
      // L'audit ne doit pas faire échouer l'opération déjà effectuée.
      if (error) console.error('[whatsapp] audit_failed', { tenantId: event.tenantId, eventType: event.eventType, code: error.code });
    },
  };
}
