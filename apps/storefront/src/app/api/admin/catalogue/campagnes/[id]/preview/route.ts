import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { isUuid } from '@/lib/catalog/campaigns';

export const runtime = 'nodejs';
export async function GET(request: NextRequest,{ params }:{ params:{ id:string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  if (!isUuid(params.id)) return NextResponse.json({ error:'Campagne introuvable.' },{ status:404 });
  const page = Math.max(1,Math.min(10000,Number.parseInt(request.nextUrl.searchParams.get('page') ?? '1',10) || 1));
  const { data,error } = await createServiceClient().rpc('catalog_campaign_preview',{
    p_tenant:tenant.id,p_campaign:params.id,p_page:page,p_size:100,
  });
  if (error) return NextResponse.json({ error:'Aperçu indisponible.' },{ status:503 });
  return data && data !== 'null' ? NextResponse.json(data) : NextResponse.json({ error:'Campagne introuvable.' },{ status:404 });
}
