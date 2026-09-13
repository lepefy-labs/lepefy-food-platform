import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';

const idSchema = z.string().uuid();
function sameOrigin(request: NextRequest) { const origin = request.headers.get('origin'); if (!origin) return true; try { return new URL(origin).host === request.nextUrl.host; } catch { return false; } }

export async function POST(request: NextRequest, { params }: { params: { id: string; inviteId: string } }) {
  const denied = await requirePlatformOwner(); if (denied) return denied;
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Requête refusée.' }, { status: 403 });
  if (!idSchema.safeParse(params.id).success || !idSchema.safeParse(params.inviteId).success) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const { data, error } = await service.from('tester_feedback_invites').update({
    revoked_at: new Date().toISOString(), delivery_status: 'revoked', invite_token_hash: null, session_token_hash: null,
  }).eq('id', params.inviteId).eq('campaign_id', params.id).is('revoked_at', null).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: 'Révocation impossible.' }, { status: 503 });
  if (!data) return NextResponse.json({ error: 'Invitation introuvable ou déjà révoquée.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
