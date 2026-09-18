import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { generateReferralCode } from '@/lib/loyalty/generateReferralCode';
import { resolveReferralDownline } from '@/lib/loyalty/resolveReferralDownline';
import { requireTermsConsentOrRedirect } from '@/lib/legal/requireTermsConsentOrRedirect';
import { ParrainageClient } from './ParrainageClient';

// Session obligatoire — même garde que /compte/connexion (getSessionCustomer
// passe par cookies(), la page est de toute façon dynamique).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParrainagePage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) redirect('/compte/connexion');
  await requireTermsConsentOrRedirect(tenant.id, customer.id, '/compte/parrainage');

  const supabase = createServiceClient();

  const [{ data: customerRow }, { data: balanceRow }] = await Promise.all([
    supabase
      .from('customers')
      .select('referral_access_granted, referral_suspended')
      .eq('id', customer.id)
      .eq('tenant_id', tenant.id)
      .single(),
    supabase
      .from('customer_points_balance')
      .select('confirmed_balance, pending_balance')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer.id)
      .maybeSingle(),
  ]);

  const eligible = (customerRow?.referral_access_granted ?? false) && !customerRow?.referral_suspended;

  let code: string | null = null;
  let progress: { currentSpend: number; threshold: number | null } | null = null;
  let nodes: { customerId: string; level: number; points: number }[] = [];

  if (eligible) {
    // code generation and downline resolution only need tenant/customer —
    // independent of each other, run in parallel.
    const [generatedCode, downline] = await Promise.all([
      generateReferralCode({
        tenantId: tenant.id,
        customerId: customer.id,
        fullName: customer.full_name,
        email: customer.email,
      }),
      resolveReferralDownline(tenant.id, customer.id, tenant.referral_max_depth),
    ]);
    code = generatedCode;

    // One batched points_ledger query for the whole downline instead of one
    // query per node — was a real N+1 (a referral tree of N people issued N
    // sequential queries here).
    const downlineIds = downline.map((n) => n.customerId);
    const { data: rows } = downlineIds.length > 0
      ? await supabase
        .from('points_ledger')
        .select('amount, reference_customer_id')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', customer.id)
        .eq('transaction_type', 'REFERRAL_EARNED')
        .in('reference_customer_id', downlineIds)
      : { data: [] as { amount: number; reference_customer_id: string }[] };
    const pointsByReferredId = new Map<string, number>();
    for (const row of rows ?? []) {
      pointsByReferredId.set(row.reference_customer_id, (pointsByReferredId.get(row.reference_customer_id) ?? 0) + row.amount);
    }
    nodes = downline.map(({ customerId, level }) => ({ customerId, level, points: pointsByReferredId.get(customerId) ?? 0 }));
  } else if (tenant.referral_availability_mode === 'SPENDING_THRESHOLD') {
    const { data: orders } = await supabase
      .from('orders')
      .select('total')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer.id)
      .eq('status', 'delivered');
    const currentSpend = (orders ?? []).reduce((sum, o) => sum + Number(o.total), 0);
    progress = { currentSpend, threshold: tenant.referral_unlock_spending_threshold };
  }

  return (
    <ParrainageClient
      eligible={eligible}
      mode={tenant.referral_availability_mode}
      code={code}
      confirmedBalance={balanceRow?.confirmed_balance ?? 0}
      pendingBalance={balanceRow?.pending_balance ?? 0}
      progress={progress}
      nodes={nodes}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''}
      currency={tenant.currency}
    />
  );
}
