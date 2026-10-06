import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { loadLiveChannel } from '@/lib/whatsapp/adminQueries';
import { channelSettingsSchema, toChannelView } from '@/lib/whatsapp/adminSchemas';
import { resolveChannelAccessToken } from '@/lib/whatsapp/provider/credentials';
import { auditWhatsAppSettings } from '@/lib/whatsapp/server/adminAudit';
import { requireWhatsAppApi } from '@/lib/whatsapp/server/featureGate';
import { CHANNEL_COLUMNS, type WhatsAppChannel } from '@/lib/whatsapp/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** PATCH réglages opérationnels : automatisation, Nala, handoff, langue, reprise auto (whatsapp.manage). */
export async function PATCH(request: NextRequest) {
  const gate = await requireWhatsAppApi();
  if (!gate.ok) return gate.response;
  const parsed = channelSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Réglages invalides.' }, { status: 400 });

  const db = createServiceClient();
  const tenantId = gate.tenant.id;
  const channel = await loadLiveChannel(db, tenantId);
  if (!channel || channel.status === 'disabled') return NextResponse.json({ error: 'Aucun canal WhatsApp configuré.' }, { status: 409 });

  const { data, error } = await db.from('tenant_whatsapp_channels').update(parsed.data)
    .eq('tenant_id', tenantId).eq('id', channel.id).select(CHANNEL_COLUMNS).single();
  if (error || !data) {
    console.error('[whatsapp] settings_save_failed', { tenantId, code: error?.code });
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
  const detail: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(parsed.data)) detail[key] = value ?? null;
  await auditWhatsAppSettings(tenantId, gate.actorId, 'channel_settings_updated', detail);

  const access = await getCurrentAdminAccessContext(tenantId);
  const updated = data as unknown as WhatsAppChannel;
  return NextResponse.json({
    channel: toChannelView(updated, { isPlatformOwner: Boolean(access?.isPlatformOwner), tokenConfigured: Boolean(resolveChannelAccessToken(updated)) }),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
