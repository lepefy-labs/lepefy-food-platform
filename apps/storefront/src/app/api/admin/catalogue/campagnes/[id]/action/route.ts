import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { isUuid } from '@/lib/catalog/campaigns';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';

export const runtime = 'nodejs';

async function handlePOST(request: NextRequest,{ params }:{ params:{ id:string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  if (!isUuid(params.id)) return NextResponse.json({ error:'Campagne introuvable.' },{ status:404 });
  const body = await request.json().catch(() => null) as Record<string,unknown> | null;
  const action = body?.action;
  if (action === 'duplicate') {
    const key = request.headers.get('Idempotency-Key') ?? body?.requestKey;
    if (!isUuid(key)) return NextResponse.json({ error:'Clé de requête requise.' },{ status:400 });
    const actor = await getCurrentAdminAccessContext(tenant.id);
    const { data,error } = await createServiceClient().rpc('catalog_campaign_duplicate',
      { p_tenant:tenant.id,p_campaign:params.id,p_actor:actor?.userId ?? null,p_key:key });
    return error ? NextResponse.json({ error:'Duplication impossible.' },{ status:503 })
      : NextResponse.json({ id:data },{ status:201 });
  }
  if (!['publish','suspend','resume','end'].includes(String(action)))
    return NextResponse.json({ error:'Action inconnue.' },{ status:400 });
  const version = Number(body?.version);
  const key = request.headers.get('Idempotency-Key') ?? body?.requestKey;
  if (!Number.isSafeInteger(version) || version<1 || !isUuid(key))
    return NextResponse.json({ error:'Version et clé de requête requises.' },{ status:400 });
  const { data,error } = await createServiceClient().rpc('catalog_campaign_action',{
    p_tenant:tenant.id,p_campaign:params.id,p_action:action,p_expected_version:version,p_key:key,
  });
  if (error) {
    const message = error.message.split(':')[0] ?? '';
    const mapped: Record<string,string> = {
      campaign_stale:'La campagne a changé. Actualisez la vérification.',
      campaign_invalid_transition:'Cette action n’est pas disponible dans l’état actuel.',
      campaign_empty:'Ajoutez au moins un produit.',
      campaign_conflict:'Une autre campagne utilise déjà un de ces produits.',
      manual_promotion:'Un produit a déjà une promotion manuelle.',
      insufficient_stock:'Le stock ne couvre pas la quantité minimale d’un produit.',
      invalid_discount:'La réduction n’est pas valide pour un produit.',
      campaign_price_changed:'Un prix a changé depuis la publication.',
    };
    return NextResponse.json({ error:mapped[message] ?? 'Action impossible. Vérifiez la campagne et réessayez.' },
      { status:message.includes('conflict') || message==='campaign_stale' ? 409 : 400 });
  }
  return NextResponse.json(data);
}
export const POST = withStorefrontInvalidation(['catalog'],handlePOST);
