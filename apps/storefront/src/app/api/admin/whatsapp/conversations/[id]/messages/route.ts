import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isTestTenantId } from '@/lib/tenant/testTenant';
import { agentMessageSchema } from '@/lib/whatsapp/adminSchemas';
import { testRecipientAllowList } from '@/lib/whatsapp/config';
import { takeOverConversation } from '@/lib/whatsapp/handoff';
import { whatsappLog } from '@/lib/whatsapp/log';
import { createChannelProvider } from '@/lib/whatsapp/provider/credentials';
import { sendConversationText } from '@/lib/whatsapp/responseService';
import { requireWhatsAppApi } from '@/lib/whatsapp/server/featureGate';
import { createHandoffStore, createOutboundStore } from '@/lib/whatsapp/server/stores';
import { CHANNEL_COLUMNS, CONVERSATION_COLUMNS, type WhatsAppChannel, type WhatsAppConversation } from '@/lib/whatsapp/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FAILURE_MESSAGES: Record<string, string> = {
  outside_window: 'Plus de 24 h depuis le dernier message du client : WhatsApp n’autorise qu’un modèle approuvé.',
  test_recipient_blocked: 'Tenant de test : ce numéro n’est pas dans WHATSAPP_TEST_RECIPIENTS.',
  provider_error: 'WhatsApp a refusé l’envoi. Réessayez ou vérifiez la configuration du canal.',
  empty: 'Message vide.',
};

/**
 * POST message d'un opérateur (whatsapp.reply), envoyé depuis le numéro du
 * tenant. Le premier message humain met l'automatisation en pause (prise en
 * main), pour que Nala et les règles ne répondent pas en parallèle.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireWhatsAppApi();
  if (!gate.ok) return gate.response;
  if (!gate.actorId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Conversation introuvable.' }, { status: 404 });
  const parsed = agentMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Message invalide.' }, { status: 400 });

  const db = createServiceClient();
  const tenantId = gate.tenant.id;
  const { data: conversationRow } = await db.from('whatsapp_conversations').select(CONVERSATION_COLUMNS)
    .eq('tenant_id', tenantId).eq('id', params.id).maybeSingle();
  const conversation = conversationRow as unknown as WhatsAppConversation | null;
  if (!conversation) return NextResponse.json({ error: 'Conversation introuvable.' }, { status: 404 });
  const { data: channelRow } = await db.from('tenant_whatsapp_channels').select(CHANNEL_COLUMNS)
    .eq('tenant_id', tenantId).eq('id', conversation.channel_id).maybeSingle();
  const channel = channelRow as unknown as WhatsAppChannel | null;
  if (!channel || channel.status === 'disabled') return NextResponse.json({ error: 'Canal WhatsApp désactivé.' }, { status: 409 });

  if (conversation.status !== 'human' || conversation.assigned_to !== gate.actorId) {
    await takeOverConversation(createHandoffStore(db), { tenantId, conversationId: conversation.id, adminId: gate.actorId });
  }

  const outcome = await sendConversationText({
    channel, conversation, body: parsed.data.body, authorType: 'agent', authorAdminId: gate.actorId,
    isTestTenant: Boolean(gate.tenant.is_test) || await isTestTenantId(tenantId),
  }, { store: createOutboundStore(db), providerFactory: createChannelProvider, log: whatsappLog, testAllowList: testRecipientAllowList() });

  if (!outcome.ok) {
    return NextResponse.json({ ok: false, reason: outcome.reason, error: FAILURE_MESSAGES[outcome.reason] ?? 'Envoi impossible.' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, messageId: outcome.messageId });
}
