import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { isUuid, loadCampaignList, parseCampaignConfig, parseCampaignList } from '@/lib/catalog/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function context() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return { tenant, denied: await requireAdmin(tenant.id) };
}

export async function GET(request: NextRequest) {
  const { tenant, denied } = await context();
  if (denied) return denied;
  try { return NextResponse.json(await loadCampaignList(createServiceClient(),tenant.id,parseCampaignList(request.nextUrl.searchParams))); }
  catch { return NextResponse.json({ error: 'Impossible de charger les campagnes.' }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  const { tenant, denied } = await context();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string,unknown> | null;
  const config = parseCampaignConfig(body);
  if (!config.ok) return NextResponse.json({ error: config.error }, { status: 400 });
  const key = request.headers.get('Idempotency-Key') ?? body?.requestKey;
  if (!isUuid(key)) return NextResponse.json({ error:'Clé de requête requise.' },{ status:400 });
  const actor = await getCurrentAdminAccessContext(tenant.id);
  const { data,error } = await createServiceClient().rpc('catalog_campaign_create',{
    p_tenant:tenant.id,p_config:config.value,p_actor:actor?.userId ?? null,p_key:key,
  });
  if (error) return NextResponse.json({ error: 'La campagne n’a pas pu être créée.' }, { status: 503 });
  return NextResponse.json({ id:data }, { status: 201 });
}
