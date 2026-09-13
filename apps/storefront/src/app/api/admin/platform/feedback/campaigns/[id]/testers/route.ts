import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { testerImportSchema } from '@/lib/feedback/contracts';
import { createServiceClient } from '@/lib/supabase/server';

const idSchema = z.string().uuid();

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (!idSchema.safeParse(params.id).success) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const { data: campaign } = await service.from('tester_feedback_campaigns').select('id, tenant_id, google_play_test_url').eq('id', params.id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  const { data: invites, error } = await service.from('tester_feedback_invites')
    .select('id, email, delivery_status, sent_at, delivery_failed_at, activated_at, revoked_at, last_feedback_at, created_at')
    .eq('campaign_id', campaign.id).eq('tenant_id', campaign.tenant_id).order('created_at');
  if (error) return NextResponse.json({ error: 'Testeurs indisponibles.' }, { status: 503 });
  const inviteIds = (invites ?? []).map((invite: { id: string }) => invite.id);
  const { data: entries } = inviteIds.length
    ? await service.from('tester_feedback_entries').select('tester_invite_id').in('tester_invite_id', inviteIds)
    : { data: [] };
  const counts = new Map<string, number>();
  for (const entry of entries ?? []) counts.set(entry.tester_invite_id, (counts.get(entry.tester_invite_id) ?? 0) + 1);
  return NextResponse.json({
    googlePlayTestUrl: campaign.google_play_test_url,
    testers: (invites ?? []).map((invite: { id: string }) => ({ ...invite, feedback_count: counts.get(invite.id) ?? 0 })),
  });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Requête refusée.' }, { status: 403 });
  if (!idSchema.safeParse(params.id).success) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  const parsed = testerImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Adresses invalides.' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const { data: campaign } = await service.from('tester_feedback_campaigns').select('id, tenant_id').eq('id', params.id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  const { data: existing } = await service.from('tester_feedback_invites').select('email').eq('campaign_id', campaign.id).in('email', parsed.data.emails);
  const existingEmails = new Set((existing ?? []).map((row: { email: string }) => row.email));
  const newEmails = parsed.data.emails.filter(email => !existingEmails.has(email));
  if (newEmails.length) {
    const { error } = await service.from('tester_feedback_invites').insert(newEmails.map(email => ({ tenant_id: campaign.tenant_id, campaign_id: campaign.id, email })));
    if (error) return NextResponse.json({ error: 'Ajout des testeurs impossible.' }, { status: 503 });
  }
  return NextResponse.json({ added: newEmails.length, skipped: parsed.data.emails.length - newEmails.length }, { status: 201 });
}
