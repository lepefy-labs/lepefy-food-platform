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

  const { data: customerRow } = await supabase
    .from('customers')
    .select('referral_access_granted, referral_suspended')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .single();

  const eligible = (customerRow?.referral_access_granted ?? false) && !customerRow?.referral_suspended;

  let code: string | null = null;
  if (eligible) {
    code = await generateReferralCode({
      tenantId: tenant.id,
      customerId: customer.id,
      fullName: customer.full_name,
      email: customer.email,
    });
  }

  const { data: balanceRow } = await supabase
    .from('customer_points_balance')
    .select('confirmed_balance, pending_balance')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', customer.id)
    .maybeSingle();

  let progress: { currentSpend: number; threshold: number | null } | null = null;
  if (!eligible && tenant.referral_availability_mode === 'SPENDING_THRESHOLD') {
    const { data: orders } = await supabase
      .from('orders')
      .select('total')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer.id)
      .eq('status', 'delivered');
    const currentSpend = (orders ?? []).reduce((sum, o) => sum + Number(o.total), 0);
    progress = { currentSpend, threshold: tenant.referral_unlock_spending_threshold };
  }

  let nodes: { customerId: string; level: number; points: number }[] = [];
  if (eligible) {
    const downline = await resolveReferralDownline(tenant.id, customer.id, tenant.referral_max_depth);
    nodes = await Promise.all(
      downline.map(async ({ customerId, level }) => {
        const { data: rows } = await supabase
          .from('points_ledger')
          .select('amount')
          .eq('tenant_id', tenant.id)
          .eq('customer_id', customer.id)
          .eq('transaction_type', 'REFERRAL_EARNED')
          .eq('reference_customer_id', customerId);
        const points = (rows ?? []).reduce((sum, r) => sum + r.amount, 0);
        return { customerId, level, points };
      }),
    );
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
