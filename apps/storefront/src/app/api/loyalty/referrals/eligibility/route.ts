import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';

// Lecture seule : visiteur non authentifié → état "non éligible" plutôt
// qu'une 401 (même choix que /balance et /tree, cf. rapport final).
export async function GET() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) {
    return NextResponse.json({
      eligible: false,
      mode: tenant.referral_availability_mode,
      reason: null,
    });
  }

  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from('customers')
    .select('referral_access_granted, referral_access_reason')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .single();

  const eligible = row?.referral_access_granted ?? false;

  const response: {
    eligible: boolean;
    mode: string;
    reason: string | null;
    progress?: { currentSpend: number; threshold: number | null };
  } = {
    eligible,
    mode: tenant.referral_availability_mode,
    reason: row?.referral_access_reason ?? null,
  };

  if (!eligible && tenant.referral_availability_mode === 'SPENDING_THRESHOLD') {
    const { data: orders } = await supabase
      .from('orders')
      .select('total')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer.id)
      .eq('status', 'delivered');
    const currentSpend = (orders ?? []).reduce((sum, o) => sum + Number(o.total), 0);
    response.progress = { currentSpend, threshold: tenant.referral_unlock_spending_threshold };
  }

  return NextResponse.json(response);
}
