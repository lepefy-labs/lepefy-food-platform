import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * Adresses enregistrées d'un client du tenant (préremplissage de la livraison)
 * et sa dernière commande non annulée (« Reprendre ces articles »). Données
 * d'affichage : prix, stock et règles sont relus à l'ajout et à l'enregistrement.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Client invalide.' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: customer } = await supabase.from('customers').select('id')
    .eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle();
  if (!customer) return NextResponse.json({ error: 'Client introuvable.' }, { status: 404 });

  const [{ data, error }, lastOrderResult] = await Promise.all([
    supabase
      .from('addresses')
      .select('id, full_name, line1, line2, city, postal_code, country, is_default')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', params.id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('orders')
      .select('id, created_at, total, order_items(product_id, name, quantity)')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', params.id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) {
    console.error('[admin/assisted-orders/customers/:id] addresses failed:', error);
    return NextResponse.json({ error: 'Adresses indisponibles.' }, { status: 500 });
  }
  if (lastOrderResult.error) console.error('[admin/assisted-orders/customers/:id] last order failed:', lastOrderResult.error);
  const last = lastOrderResult.data as { id: string; created_at: string; total: number; order_items: Array<{ product_id: string | null; name: string; quantity: number }> | null } | null;
  return NextResponse.json({
    addresses: data ?? [],
    lastOrder: last && (last.order_items ?? []).length > 0
      ? {
          id: last.id,
          createdAt: last.created_at,
          total: Number(last.total),
          items: (last.order_items ?? []).map((item) => ({ productId: item.product_id, name: item.name, quantity: item.quantity })),
        }
      : null,
  });
}
