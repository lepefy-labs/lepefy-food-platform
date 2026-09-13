import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { campaignPatchSchema } from '@/lib/feedback/contracts';

const idSchema = z.string().uuid();

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Requête refusée.' }, { status: 403 });
  if (!idSchema.safeParse(params.id).success) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  const parsed = campaignPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Données invalides.' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const fields = parsed.data;
  const update = {
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.versionLabel !== undefined ? { version_label: fields.versionLabel || null } : {}),
    ...(fields.headline !== undefined ? { headline: fields.headline } : {}),
    ...(fields.intro !== undefined ? { intro: fields.intro || null } : {}),
    ...(fields.thankYouMessage !== undefined ? { thank_you_message: fields.thankYouMessage || null } : {}),
  };
  if (Object.keys(update).length) {
    const { error } = await service.from('tester_feedback_campaigns').update(update).eq('id', params.id);
    if (error) return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 503 });
  }
  if (fields.active !== undefined) {
    const { error } = await service.rpc('set_tester_feedback_campaign_active', { p_campaign_id: params.id, p_active: fields.active });
    if (error) return NextResponse.json({ error: 'Changement d’état impossible.' }, { status: 503 });
  }
  const { data, error } = await service.from('tester_feedback_campaigns').select('*').eq('id', params.id).single();
  if (error || !data) return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  return NextResponse.json({ campaign: data });
}
