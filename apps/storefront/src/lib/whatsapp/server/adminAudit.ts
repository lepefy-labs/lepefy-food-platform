import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

/** Audit des réglages du canal (sans conversation). detail : jamais de contenu, de numéro client ni de secret. */
export async function auditWhatsAppSettings(tenantId: string, adminId: string | null, eventType: string, detail: Record<string, string | number | boolean | null>): Promise<void> {
  const { error } = await createServiceClient().from('whatsapp_audit_events').insert({
    tenant_id: tenantId, conversation_id: null, event_type: eventType, actor_type: 'admin', actor_admin_id: adminId, detail,
  });
  if (error) console.error('[whatsapp] audit_failed', { tenantId, eventType, code: error.code });
}
