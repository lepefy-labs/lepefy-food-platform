import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { sendTesterFeedbackInvite } from '@/lib/notifications/notifyTesterFeedbackInvite';
import { createServiceClient } from '@/lib/supabase/server';

const idSchema = z.string().uuid();
function sameOrigin(request: NextRequest) { const origin = request.headers.get('origin'); if (!origin) return true; try { return new URL(origin).host === request.nextUrl.host; } catch { return false; } }

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner(); if (denied) return denied;
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Requête refusée.' }, { status: 403 });
  if (!idSchema.safeParse(params.id).success) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const { data: campaign } = await service.from('tester_feedback_campaigns').select('id, google_play_test_url').eq('id', params.id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  if (!campaign.google_play_test_url) return NextResponse.json({ error: 'Ajoutez d’abord l’URL du test Google Play.' }, { status: 409 });
  const { data: invites } = await service.from('tester_feedback_invites').select('id').eq('campaign_id', campaign.id)
    .in('delivery_status', ['pending', 'delivery_failed']).is('revoked_at', null).is('activated_at', null);
  let sent = 0; let failed = 0;
  for (const invite of invites ?? []) {
    const result = await sendTesterFeedbackInvite(invite.id);
    if (result.ok) sent += 1; else failed += 1;
  }
  return NextResponse.json({ sent, failed });
}
