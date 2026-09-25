import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Catalogue réel et actif du tenant pour la saisie (nom, image, prix,
 * disponibilité, règles minimum/pas). Données d'affichage uniquement : le
 * serveur relit prix, stock et règles à chaque enregistrement.
 */
export async function GET(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().replace(/[%_,()]/g, '').slice(0, 60);
  const idsParam = req.nextUrl.searchParams.get('ids');
  const ids = (idsParam ?? '').split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);

  let query = createServiceClient()
    .from('products')
    .select('id, name, price, compare_at_price, image_url, stock, storage_type, weight_grams, min_order_quantity, order_quantity_step')
    .eq('tenant_id', tenant.id)
    .eq('active', true);

  if (ids.length > 0) query = query.in('id', ids);
  else if (q) query = query.ilike('name', `%${q}%`);

  const { data, error } = await query.order('name', { ascending: true }).limit(ids.length > 0 ? 100 : 24);
  if (error) {
    console.error('[admin/assisted-orders/products] search failed:', error);
    return NextResponse.json({ error: 'Catalogue indisponible.' }, { status: 500 });
  }
  return NextResponse.json({ products: data ?? [] });
}
