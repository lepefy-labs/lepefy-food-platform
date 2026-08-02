import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

// "Retirer le statut" — les commissions déjà générées (ambassador_commissions)
// ne sont jamais touchées ici : is_ambassador ne redevenir false ne fait que
// bloquer les FUTURES attributions de commission (process_ambassador_commission_atomic
// vérifie is_ambassador au moment de la livraison, pas au moment du signup).
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { customerId?: string };
  if (!body.customerId) {
    return NextResponse.json({ error: 'customerId requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('customers')
    .update({ is_ambassador: false })
    .eq('id', body.customerId)
    .eq('tenant_id', tenant.id)
    .select('id, is_ambassador')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
