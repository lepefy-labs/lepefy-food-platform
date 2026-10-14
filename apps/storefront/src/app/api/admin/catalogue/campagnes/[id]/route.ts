import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { isUuid, loadCampaign, parseCampaignConfig } from '@/lib/catalog/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest,{ params }:{ params:{ id:string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  if (!isUuid(params.id)) return NextResponse.json({ error:'Campagne introuvable.' },{ status:404 });
  try {
    const page = Math.max(1,Math.min(10000,Number.parseInt(request.nextUrl.searchParams.get('selectedPage') ?? '1',10) || 1));
    const data = await loadCampaign(createServiceClient(),tenant.id,params.id,page);
    return data ? NextResponse.json(data) : NextResponse.json({ error:'Campagne introuvable.' },{ status:404 });
  } catch { return NextResponse.json({ error:'Impossible de charger la campagne.' },{ status:503 }); }
}

export async function PATCH(request: NextRequest,{ params }:{ params:{ id:string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  if (!isUuid(params.id)) return NextResponse.json({ error:'Campagne introuvable.' },{ status:404 });
  const body = await request.json().catch(() => null) as Record<string,unknown> | null;
  const parsed = parseCampaignConfig(body);
  if (!parsed.ok) return NextResponse.json({ error:parsed.error },{ status:400 });
  const version = Number(body?.version);
  if (!Number.isSafeInteger(version) || version<1) return NextResponse.json({ error:'Version de campagne requise.' },{ status:400 });
  const { data,error } = await createServiceClient().from('catalog_campaigns')
    .update({ ...parsed.value,version:version+1,updated_at:new Date().toISOString() })
    .eq('tenant_id',tenant.id).eq('id',params.id).eq('version',version)
    .in('status',['draft','suspended']).select('id,version').maybeSingle();
  if (error) return NextResponse.json({ error:'Modification impossible.' },{ status:503 });
  if (!data) return NextResponse.json({ error:'La campagne a changé ou doit d’abord être suspendue.' },{ status:409 });
  return NextResponse.json(data);
}
