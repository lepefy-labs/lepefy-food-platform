import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isTestTenantId } from '@/lib/tenant/testTenant';
import { loadLiveChannel } from '@/lib/whatsapp/adminQueries';
import { testMessageSchema } from '@/lib/whatsapp/adminSchemas';
import { testRecipientAllowList } from '@/lib/whatsapp/config';
import { whatsappLog } from '@/lib/whatsapp/log';
import { createChannelProvider } from '@/lib/whatsapp/provider/credentials';
import { WhatsAppProviderError } from '@/lib/whatsapp/provider/types';
import { auditWhatsAppSettings } from '@/lib/whatsapp/server/adminAudit';
import { requireWhatsAppApi } from '@/lib/whatsapp/server/featureGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Envoi d'un template de test (par défaut `hello_world`, fourni par Meta avec le
 * numéro de test) : valide jeton + phone_number_id + destinataire autorisé.
 * Platform owner uniquement. Ne crée aucune conversation.
 */
export async function POST(request: NextRequest) {
  const gate = await requireWhatsAppApi({ platformOnly: true });
  if (!gate.ok) return gate.response;
  const parsed = testMessageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Destinataire invalide.' }, { status: 400 });

  const tenantId = gate.tenant.id;
  const channel = await loadLiveChannel(createServiceClient(), tenantId);
  if (!channel || channel.status === 'disabled') return NextResponse.json({ error: 'Aucun canal WhatsApp configuré.' }, { status: 409 });
  if ((gate.tenant.is_test || await isTestTenantId(tenantId)) && !testRecipientAllowList().includes(parsed.data.to)) {
    return NextResponse.json({ error: 'Tenant de test : ajoutez ce numéro à WHATSAPP_TEST_RECIPIENTS.' }, { status: 409 });
  }

  try {
    const result = await createChannelProvider(channel).sendTemplate(parsed.data.to, parsed.data.template, parsed.data.language);
    await auditWhatsAppSettings(tenantId, gate.actorId, 'channel_test_sent', { template: parsed.data.template });
    return NextResponse.json({ ok: true, providerMessageId: result.providerMessageId });
  } catch (error) {
    const providerError = error instanceof WhatsAppProviderError ? error : new WhatsAppProviderError({ kind: 'unknown' });
    whatsappLog('provider_error', { tenantId, kind: providerError.kind, code: providerError.code, context: 'channel_test' });
    return NextResponse.json({ ok: false, error: providerError.kind, code: providerError.code, message: providerError.message }, { status: 502 });
  }
}
