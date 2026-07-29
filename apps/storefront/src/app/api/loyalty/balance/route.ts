import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';

// Lecture seule : un visiteur non authentifié reçoit un solde à zéro plutôt
// qu'une 401 — cohérent avec un affichage "0 pt" par défaut côté UI plutôt
// qu'un état d'erreur (choix documenté dans le rapport, la spec laissait le
// choix pour les endpoints de lecture).
export async function GET() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) {
    return NextResponse.json({ confirmed_balance: 0, pending_balance: 0 });
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('customer_points_balance')
    .select('confirmed_balance, pending_balance')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', customer.id)
    .maybeSingle();

  return NextResponse.json({
    confirmed_balance: data?.confirmed_balance ?? 0,
    pending_balance:   data?.pending_balance   ?? 0,
  });
}
