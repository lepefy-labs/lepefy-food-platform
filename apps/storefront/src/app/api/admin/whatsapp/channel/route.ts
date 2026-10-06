import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { loadLiveChannel } from '@/lib/whatsapp/adminQueries';
import { channelIdentitySchema, toChannelView } from '@/lib/whatsapp/adminSchemas';
import { resolveChannelAccessToken } from '@/lib/whatsapp/provider/credentials';
import { auditWhatsAppSettings } from '@/lib/whatsapp/server/adminAudit';
import { requireWhatsAppApi } from '@/lib/whatsapp/server/featureGate';
import { CHANNEL_COLUMNS, type WhatsAppChannel } from '@/lib/whatsapp/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** GET canal WhatsApp du tenant (whatsapp.view). Les identifiants Meta ne sont visibles que du platform owner. */
export async function GET() {
  const gate = await requireWhatsAppApi();
  if (!gate.ok) return gate.response;
  const [channel, access] = await Promise.all([
    loadLiveChannel(createServiceClient(), gate.tenant.id),
    getCurrentAdminAccessContext(gate.tenant.id),
  ]);
  return NextResponse.json({
    channel: channel ? toChannelView(channel, {
      isPlatformOwner: Boolean(access?.isPlatformOwner), tokenConfigured: Boolean(resolveChannelAccessToken(channel)),
    }) : null,
  }, { headers: NO_STORE });
}

/**
 * PUT identité du numéro (platform owner + whatsapp.manage). Associe un
 * phone_number_id Meta au tenant du déploiement : décision de confiance de la
 * plateforme, jamais en libre-service tenant (un tenant ne doit pas pouvoir
 * revendiquer le numéro d'un autre).
 */
export async function PUT(request: NextRequest) {
  const gate = await requireWhatsAppApi({ platformOnly: true });
  if (!gate.ok) return gate.response;
  const parsed = channelIdentitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Configuration invalide.', issues: parsed.error.issues.map((issue) => issue.message) }, { status: 400 });
  }
  const db = createServiceClient();
  const tenantId = gate.tenant.id;
  const existing = await loadLiveChannel(db, tenantId);
  const values = { ...parsed.data, provider: 'meta_cloud' as const };

  const result = existing
    ? await db.from('tenant_whatsapp_channels').update(values).eq('tenant_id', tenantId).eq('id', existing.id).select(CHANNEL_COLUMNS).single()
    : await db.from('tenant_whatsapp_channels').insert({ ...values, tenant_id: tenantId }).select(CHANNEL_COLUMNS).single();
  if (result.error || !result.data) {
    if (result.error?.code === '23505') {
      return NextResponse.json({ error: 'Ce numéro (phone_number_id) est déjà associé à un canal. Désactivez-le d’abord.' }, { status: 409 });
    }
    console.error('[whatsapp] channel_save_failed', { tenantId, code: result.error?.code });
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
  const channel = result.data as unknown as WhatsAppChannel;
  await auditWhatsAppSettings(tenantId, gate.actorId, existing ? 'channel_updated' : 'channel_created', {
    environment: channel.environment, status: channel.status, own_token_env: Boolean(channel.access_token_env),
  });
  return NextResponse.json({
    channel: toChannelView(channel, { isPlatformOwner: true, tokenConfigured: Boolean(resolveChannelAccessToken(channel)) }),
  }, { headers: NO_STORE });
}
