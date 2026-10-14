import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { isUuid } from '@/lib/catalog/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest,{ params }:{ params:{ id:string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  if (!isUuid(params.id)) return NextResponse.json({ error:'Campagne introuvable.' },{ status:404 });
  const db = createServiceClient();
  const s = request.nextUrl.searchParams;
  const q = (s.get('q') ?? '').trim().replace(/[%_,()]/g,' ').slice(0,80);
  const category = s.get('category');
  const active = s.get('active');
  const available = s.get('available');
  const page = Math.max(1,Math.min(10000,Number.parseInt(s.get('page') ?? '1',10) || 1));
  const size = 25;
  const { data,error } = await db.rpc('catalog_campaign_search_products',{
    p_tenant:tenant.id,p_campaign:params.id,p_query:q || null,
    p_category:category && isUuid(category) ? category : null,
    p_active:active==='true' ? true : active==='false' ? false : null,
    p_available:available==='true' ? true : available==='false' ? false : null,
    p_page:page,p_size:size,
  });
  if (error) return NextResponse.json({ error:'Recherche indisponible.' },{ status:503 });
  return NextResponse.json(data ?? { products:[],total:0,page,size });
}
