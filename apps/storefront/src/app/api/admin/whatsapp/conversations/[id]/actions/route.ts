import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { conversationActionSchema } from '@/lib/whatsapp/adminSchemas';
import { closeConversation, resumeAutomation, takeOverConversation } from '@/lib/whatsapp/handoff';
import { whatsappLog } from '@/lib/whatsapp/log';
import { requireWhatsAppApi } from '@/lib/whatsapp/server/featureGate';
import { createHandoffStore } from '@/lib/whatsapp/server/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST prise en main / reprise de l'automatisation / clôture / lu (whatsapp.reply). Audité. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireWhatsAppApi();
  if (!gate.ok) return gate.response;
  if (!gate.actorId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Conversation introuvable.' }, { status: 404 });
  const parsed = conversationActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Action invalide.' }, { status: 400 });

  const db = createServiceClient();
  const tenantId = gate.tenant.id;
  const { data: conversation } = await db.from('whatsapp_conversations').select('id')
    .eq('tenant_id', tenantId).eq('id', params.id).maybeSingle();
  if (!conversation) return NextResponse.json({ error: 'Conversation introuvable.' }, { status: 404 });

  const store = createHandoffStore(db);
  const base = { tenantId, conversationId: params.id };
  switch (parsed.data.action) {
    case 'take_over':
      await takeOverConversation(store, { ...base, adminId: gate.actorId });
      break;
    case 'resume':
      await resumeAutomation(store, { ...base, adminId: gate.actorId, log: whatsappLog });
      break;
    case 'close':
      await closeConversation(store, { ...base, adminId: gate.actorId });
      break;
    case 'mark_read':
      await store.updateConversation(tenantId, params.id, { unread_count: 0 });
      break;
  }
  return NextResponse.json({ ok: true });
}
