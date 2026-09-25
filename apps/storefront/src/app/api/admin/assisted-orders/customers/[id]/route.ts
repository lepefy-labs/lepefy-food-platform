import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Adresses enregistrées d'un client du tenant, pour préremplir la livraison. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Client invalide.' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: customer } = await supabase.from('customers').select('id')
    .eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle();
  if (!customer) return NextResponse.json({ error: 'Client introuvable.' }, { status: 404 });

  const { data, error } = await supabase
    .from('addresses')
    .select('id, full_name, line1, line2, city, postal_code, country, is_default')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', params.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) {
    console.error('[admin/assisted-orders/customers/:id] addresses failed:', error);
    return NextResponse.json({ error: 'Adresses indisponibles.' }, { status: 500 });
  }
  return NextResponse.json({ addresses: data ?? [] });
}
