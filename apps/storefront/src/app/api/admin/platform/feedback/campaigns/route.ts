import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { campaignCreateSchema } from '@/lib/feedback/contracts';

export const dynamic = 'force-dynamic';

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function GET() {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const [campaignsResult, tenantsResult] = await Promise.all([
    service.from('tester_feedback_campaign_admin').select('*').order('created_at', { ascending: false }),
    service.from('tenants').select('id, name').order('name'),
  ]);
  if (campaignsResult.error) return NextResponse.json({ error: 'Campagnes indisponibles.' }, { status: 503 });
  const tenantNames = new Map((tenantsResult.data ?? []).map((item: { id: string; name: string }) => [item.id, item.name]));
  return NextResponse.json({
    campaigns: (campaignsResult.data ?? []).map((campaign: { tenant_id: string }) => ({ ...campaign, tenant_name: tenantNames.get(campaign.tenant_id) ?? 'Tenant' })),
    tenants: tenantsResult.data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Requête refusée.' }, { status: 403 });
  const parsed = campaignCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Données invalides.' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const { data: tenant } = await service.from('tenants').select('id').eq('id', parsed.data.tenantId).single();
  if (!tenant) return NextResponse.json({ error: 'Tenant introuvable.' }, { status: 400 });
  const { data, error } = await service.from('tester_feedback_campaigns').insert({
    tenant_id: parsed.data.tenantId,
    name: parsed.data.name,
    version_label: parsed.data.versionLabel || null,
    headline: parsed.data.headline,
    intro: parsed.data.intro || null,
    thank_you_message: parsed.data.thankYouMessage || null,
    active: false,
  }).select('*').single();
  if (error || !data) return NextResponse.json({ error: 'Création impossible.' }, { status: 503 });
  if (parsed.data.active) {
    const { error: activationError } = await service.rpc('set_tester_feedback_campaign_active', { p_campaign_id: data.id, p_active: true });
    if (activationError) return NextResponse.json({ error: 'Campagne créée, mais activation impossible.' }, { status: 503 });
  }
  return NextResponse.json({ campaign: data }, { status: 201 });
}
