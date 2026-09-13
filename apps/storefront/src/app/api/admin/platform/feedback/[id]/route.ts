import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { feedbackUpdateSchema } from '@/lib/feedback/contracts';

export const dynamic = 'force-dynamic';

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
  const { data: entry, error } = await service.from('tester_feedback_entries').select('*').eq('id', params.id).single();
  if (error || !entry) return NextResponse.json({ error: 'Feedback introuvable.' }, { status: 404 });
  const [tenantResult, campaignResult] = await Promise.all([
    service.from('tenants').select('id, name').eq('id', entry.tenant_id).single(),
    service.from('tester_feedback_campaigns').select('id, name, version_label').eq('id', entry.campaign_id).single(),
  ]);
  const inviteResult = entry.tester_invite_id
    ? await service.from('tester_feedback_invites').select('email').eq('id', entry.tester_invite_id).eq('tenant_id', entry.tenant_id).maybeSingle()
    : { data: null };
  return NextResponse.json({
    entry: {
      ...entry,
      contact_email: entry.contact_allowed ? entry.contact_email : null,
      tenant_name: tenantResult.data?.name ?? 'Tenant',
      campaign: campaignResult.data ?? null,
      tester_invite_email: inviteResult.data?.email ?? null,
    },
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Requête refusée.' }, { status: 403 });
  if (!idSchema.safeParse(params.id).success) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  const parsed = feedbackUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Données invalides.' }, { status: 400 });
  const update = {
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
    ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
    ...('internalNote' in parsed.data ? { internal_note: parsed.data.internalNote || null } : {}),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const { data, error } = await service.from('tester_feedback_entries').update(update).eq('id', params.id).select('id, status, priority, internal_note, updated_at').single();
  if (error || !data) return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 503 });
  return NextResponse.json({ entry: data });
}
