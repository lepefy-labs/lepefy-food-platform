import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createOpaqueToken, hashOpaqueToken, isInviteTokenExpired, isOpaqueToken, TESTER_SESSION_COOKIE, TESTER_SESSION_MAX_AGE_SECONDS } from '@/lib/feedback/testerInviteTokens';

export const runtime = 'nodejs';

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Requête refusée.' }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const token = form?.get('token');
  if (typeof token !== 'string' || !isOpaqueToken(token)) return NextResponse.redirect(new URL('/feedback', request.url), 303);
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const inviteHash = hashOpaqueToken(token);
  const { data: invite } = await service.from('tester_feedback_invites')
    .select('id, tenant_id, campaign_id, invite_token_created_at, invite_token_used_at, revoked_at, sent_at')
    .eq('invite_token_hash', inviteHash).maybeSingle();
  const invitePage = new URL(`/feedback/invite/${encodeURIComponent(token)}`, request.url);
  if (!invite || invite.tenant_id !== tenant.id || invite.revoked_at || !invite.sent_at || isInviteTokenExpired(invite.invite_token_created_at)) return NextResponse.redirect(invitePage, 303);
  if (invite.invite_token_used_at) return NextResponse.redirect(invitePage, 303);
  const { data: campaign } = await service.from('tester_feedback_campaigns').select('id').eq('id', invite.campaign_id).eq('tenant_id', tenant.id).eq('active', true).maybeSingle();
  if (!campaign) return NextResponse.redirect(invitePage, 303);

  const sessionToken = createOpaqueToken();
  const now = new Date().toISOString();
  const { data: activated } = await service.from('tester_feedback_invites').update({
    session_token_hash: hashOpaqueToken(sessionToken), invite_token_used_at: now, activated_at: now, delivery_status: 'activated',
  }).eq('id', invite.id).eq('campaign_id', campaign.id).eq('invite_token_hash', inviteHash).is('invite_token_used_at', null).is('revoked_at', null).select('id').maybeSingle();
  if (!activated) return NextResponse.redirect(invitePage, 303);

  const response = NextResponse.redirect(new URL('/feedback', request.url), 303);
  response.cookies.set(TESTER_SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: TESTER_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
