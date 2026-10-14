import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { isUuid } from '@/lib/catalog/campaigns';

export const runtime = 'nodejs';
type Params = { params:{ id:string } };

async function scope(id:string) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return { tenant, denied:await requireAdmin(tenant.id), valid:isUuid(id) };
}

export async function POST(request:NextRequest,{ params }:Params) {
  const { tenant,denied,valid } = await scope(params.id);
  if (denied) return denied;
  if (!valid) return NextResponse.json({ error:'Campagne introuvable.' },{ status:404 });
  const body = await request.json().catch(() => null) as Record<string,unknown> | null;
  const all = body?.all === true;
  const ids = Array.isArray(body?.ids) && body.ids.every(isUuid) ? [...new Set(body.ids as string[])] : null;
  if (!all && (!ids || ids.length===0)) return NextResponse.json({ error:'Sélection vide.' },{ status:400 });
  const filters = body?.filters && typeof body.filters==='object' ? body.filters as Record<string,unknown> : {};
  const category = isUuid(filters.category) ? filters.category : null;
  const query = typeof filters.q==='string' ? filters.q.trim().replace(/[%_,()]/g,' ').slice(0,80) : null;
  const active = typeof filters.active==='boolean' ? filters.active : null;
  const available = typeof filters.available==='boolean' ? filters.available : null;
  const { data,error } = await createServiceClient().rpc('catalog_campaign_select_products',{
    p_tenant:tenant.id,p_campaign:params.id,p_ids:all ? null : ids,
    p_query:all ? query : null,p_category:all ? category : null,
    p_active:all ? active : null,p_available:all ? available : null,
  });
  if (error) return NextResponse.json({ error:'La sélection n’a pas pu être enregistrée.' },{ status:409 });
  return NextResponse.json({ added:data });
}

export async function DELETE(request:NextRequest,{ params }:Params) {
  const { tenant,denied,valid } = await scope(params.id);
  if (denied) return denied;
  if (!valid) return NextResponse.json({ error:'Campagne introuvable.' },{ status:404 });
  const body = await request.json().catch(() => null) as Record<string,unknown> | null;
  const ids = body?.all === true ? null : Array.isArray(body?.ids) && body.ids.every(isUuid)
    ? [...new Set(body.ids as string[])] : undefined;
  if (ids === undefined || (ids !== null && ids.length===0))
    return NextResponse.json({ error:'Sélection vide.' },{ status:400 });
  const { data,error } = await createServiceClient().rpc('catalog_campaign_remove_products',{
    p_tenant:tenant.id,p_campaign:params.id,p_ids:ids,
  });
  if (error) return NextResponse.json({ error:'Les produits n’ont pas pu être retirés.' },{ status:409 });
  return NextResponse.json({ removed:data });
}

export async function PATCH(request:NextRequest,{ params }:Params) {
  const { tenant,denied,valid } = await scope(params.id);
  if (denied) return denied;
  if (!valid) return NextResponse.json({ error:'Campagne introuvable.' },{ status:404 });
  const body = await request.json().catch(() => null) as Record<string,unknown> | null;
  if (!isUuid(body?.productId)) return NextResponse.json({ error:'Produit invalide.' },{ status:400 });
  const price = body?.price === null || body?.price === '' ? null : Number(body?.price);
  if (price !== null && (!Number.isFinite(price) || price<=0))
    return NextResponse.json({ error:'Prix promotionnel invalide.' },{ status:400 });
  const { error } = await createServiceClient().rpc('catalog_campaign_override_price',{
    p_tenant:tenant.id,p_campaign:params.id,p_product:body.productId,p_price:price,
  });
  if (error) return NextResponse.json({ error:'Prix non enregistré.' },{ status:409 });
  return NextResponse.json({ ok:true });
}
