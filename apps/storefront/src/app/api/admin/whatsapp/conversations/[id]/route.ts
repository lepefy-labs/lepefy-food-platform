import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { loadConversationDetail } from '@/lib/whatsapp/adminQueries';
import { auditWhatsAppSettings } from '@/lib/whatsapp/server/adminAudit';
import { requireWhatsAppApi } from '@/lib/whatsapp/server/featureGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET conversation + messages (whatsapp.view). Id d'un autre tenant = 404, comme un id inexistant. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireWhatsAppApi();
  if (!gate.ok) return gate.response;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Conversation introuvable.' }, { status: 404 });
  try {
    const detail = await loadConversationDetail(createServiceClient(), gate.tenant.id, params.id);
    if (!detail) return NextResponse.json({ error: 'Conversation introuvable.' }, { status: 404 });
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Lecture impossible.' }, { status: 500 });
  }
}

/**
 * DELETE (whatsapp.manage) : effacement d'une conversation à la demande du
 * client (RGPD). Supprime messages, handoffs et audit de la conversation
 * (cascade). L'effacement lui-même est audité sans donnée personnelle.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireWhatsAppApi();
  if (!gate.ok) return gate.response;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Conversation introuvable.' }, { status: 404 });
  const { data, error } = await createServiceClient().from('whatsapp_conversations')
    .delete().eq('tenant_id', gate.tenant.id).eq('id', params.id).select('id');
  if (error) return NextResponse.json({ error: 'Suppression impossible.' }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: 'Conversation introuvable.' }, { status: 404 });
  await auditWhatsAppSettings(gate.tenant.id, gate.actorId, 'conversation_erased', {});
  return NextResponse.json({ ok: true });
}
