import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { generateReferralCode } from '@/lib/loyalty/generateReferralCode';

export async function POST() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from('customers')
    .select('referral_access_granted, referral_suspended')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .single();

  // referral_suspended n'est pas mentionné explicitement dans la spec pour cet
  // endpoint, mais laisser un compte suspendu pour fraude continuer à générer
  // / partager son code viderait AUTO_BLOCK de son effet (voir rapport final).
  if (!row?.referral_access_granted || row.referral_suspended) {
    const responseBody: { eligible: false; mode: string; progress?: { currentSpend: number; threshold: number | null } } = {
      eligible: false,
      mode: tenant.referral_availability_mode,
    };

    if (tenant.referral_availability_mode === 'SPENDING_THRESHOLD') {
      const { data: orders } = await supabase
        .from('orders')
        .select('total')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', customer.id)
        .eq('status', 'delivered');
      const currentSpend = (orders ?? []).reduce((sum, o) => sum + Number(o.total), 0);
      responseBody.progress = { currentSpend, threshold: tenant.referral_unlock_spending_threshold };
    }

    return NextResponse.json(responseBody, { status: 403 });
  }

  const code = await generateReferralCode({
    tenantId: tenant.id,
    customerId: customer.id,
    fullName: customer.full_name,
    email: customer.email,
  });

  return NextResponse.json({ code });
}
