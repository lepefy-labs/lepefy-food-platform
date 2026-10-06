import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { resumeAutomation } from '@/lib/whatsapp/handoff';
import { whatsappLog } from '@/lib/whatsapp/log';
import { isAuthorizedInternalRequest } from '@/lib/whatsapp/server/internalAuth';
import { processPendingWhatsAppMessages } from '@/lib/whatsapp/server/processing';
import { createHandoffStore } from '@/lib/whatsapp/server/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({ action: z.enum(['sweep', 'purge']) }).strict();

/**
 * Planificateur n8n (ops/n8n/whatsapp-maintenance.json) :
 * - sweep (chaque minute) : reprend les messages restés en attente (dispatch
 *   n8n perdu, timeout, crash) et réactive l'automatisation des conversations
 *   dont la reprise automatique est échue ;
 * - purge (chaque nuit) : retention (purge_expired_whatsapp_data, 180 / 365 jours).
 * Idempotent, sans contenu ni numéro dans la réponse.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedInternalRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  const db = createServiceClient();

  if (parsed.data.action === 'purge') {
    const { data, error } = await db.rpc('purge_expired_whatsapp_data', { p_message_retention_days: 180, p_conversation_retention_days: 365 });
    if (error) {
      whatsappLog('maintenance', { action: 'purge', ok: false });
      return NextResponse.json({ ok: false, error: 'purge_failed' }, { status: 500 });
    }
    const row = (Array.isArray(data) ? data[0] : data) as { out_deleted_messages?: number; out_deleted_conversations?: number } | null;
    const result = { deletedMessages: Number(row?.out_deleted_messages ?? 0), deletedConversations: Number(row?.out_deleted_conversations ?? 0) };
    whatsappLog('maintenance', { action: 'purge', ok: true, ...result });
    return NextResponse.json({ ok: true, ...result });
  }

  let resumed = 0;
  const { data: due, error: dueError } = await db.from('whatsapp_conversations')
    .select('id, tenant_id')
    .eq('automation_status', 'paused').not('automation_resume_at', 'is', null)
    .lte('automation_resume_at', new Date().toISOString())
    .limit(50);
  if (!dueError) {
    const store = createHandoffStore(db);
    for (const conversation of due ?? []) {
      try {
        await resumeAutomation(store, { tenantId: conversation.tenant_id as string, conversationId: conversation.id as string, adminId: null, automatic: true, log: whatsappLog });
        resumed += 1;
      } catch {
        whatsappLog('maintenance', { action: 'auto_resume', ok: false, tenantId: conversation.tenant_id as string });
      }
    }
  }

  try {
    const result = await processPendingWhatsAppMessages({ minAgeSeconds: 30, limit: 25 });
    whatsappLog('maintenance', { action: 'sweep', ok: true, resumed, ...result });
    return NextResponse.json({ ok: true, resumed, ...result });
  } catch {
    whatsappLog('maintenance', { action: 'sweep', ok: false, resumed });
    return NextResponse.json({ ok: false, error: 'sweep_failed', resumed }, { status: 500 });
  }
}
