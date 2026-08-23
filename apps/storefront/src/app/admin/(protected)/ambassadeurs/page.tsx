import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { AmbassadorConfigSection } from './AmbassadorConfigSection';
import { PromoteAmbassadorSection } from './PromoteAmbassadorSection';
import { AmbassadorsListSection, type AmbassadorListRow } from './AmbassadorsListSection';
import { CommissionsSection, type CommissionRow } from './CommissionsSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface AmbassadorCustomerRow {
  id: string;
  email: string;
  full_name: string | null;
  ambassador_first_name: string | null;
  ambassador_last_name: string | null;
  ambassador_payment_method: 'IBAN' | 'PAYPAL' | null;
  ambassador_profile_completed_at: string | null;
  promoted_to_ambassador_at: string | null;
}

interface BalanceRow {
  ambassador_customer_id: string;
  status: 'CONFIRMED' | 'PAID' | 'CANCELLED';
  commission_amount: number;
}

export default async function AdminAmbassadeursPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();

  const [{ data: ambassadors }, { data: balances }, { data: commissions }] = await Promise.all([
    supabase
      .from('customers')
      .select('id, email, full_name, ambassador_first_name, ambassador_last_name, ambassador_payment_method, ambassador_profile_completed_at, promoted_to_ambassador_at')
      .eq('tenant_id', tenant.id)
      .eq('is_ambassador', true)
      .order('promoted_to_ambassador_at', { ascending: false }) as unknown as { data: AmbassadorCustomerRow[] | null },
    supabase
      .from('ambassador_commissions')
      .select('ambassador_customer_id, status, commission_amount')
      .eq('tenant_id', tenant.id) as unknown as { data: BalanceRow[] | null },
    supabase
      .from('ambassador_commissions')
      .select('*, ambassador:ambassador_customer_id(email, full_name, ambassador_first_name, ambassador_last_name), referred:referred_customer_id(email, full_name)')
      .eq('tenant_id', tenant.id)
      .eq('status', 'CONFIRMED')
      .order('created_at', { ascending: false })
      .limit(200) as unknown as { data: CommissionRow[] | null },
  ]);

  const balanceByAmbassador = new Map<string, { confirmed: number; paid: number }>();
  for (const row of balances ?? []) {
    const entry = balanceByAmbassador.get(row.ambassador_customer_id) ?? { confirmed: 0, paid: 0 };
    if (row.status === 'CONFIRMED') entry.confirmed += Number(row.commission_amount);
    if (row.status === 'PAID') entry.paid += Number(row.commission_amount);
    balanceByAmbassador.set(row.ambassador_customer_id, entry);
  }

  const ambassadorRows: AmbassadorListRow[] = (ambassadors ?? []).map((a) => ({
    ...a,
    confirmedBalance: balanceByAmbassador.get(a.id)?.confirmed ?? 0,
    paidTotal: balanceByAmbassador.get(a.id)?.paid ?? 0,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Programme Ambassadeur"
        description="Pilotez la configuration, les accès ambassadeur et les commissions confirmées depuis un espace opérationnel unique."
        meta={`${ambassadorRows.length} ambassadeur${ambassadorRows.length !== 1 ? 's' : ''}`}
      />

      <div className="space-y-6">
        <AdminBlockAccent tone="primary">
          <AmbassadorConfigSection
            ambassador_min_purchase_amount={tenant.ambassador_min_purchase_amount}
            ambassador_min_commission_amount={tenant.ambassador_min_commission_amount}
            ambassador_max_commission_amount={tenant.ambassador_max_commission_amount}
            ambassador_loyalty_from_second_order={tenant.ambassador_loyalty_from_second_order}
            ambassador_first_order_discount_type={tenant.ambassador_first_order_discount_type}
            ambassador_first_order_discount_value={tenant.ambassador_first_order_discount_value}
            ambassador_payout_threshold_amount={tenant.ambassador_payout_threshold_amount}
            ambassador_commission_mode={tenant.ambassador_commission_mode}
            ambassador_split_pool_amount={tenant.ambassador_split_pool_amount}
            ambassador_split_pool_ambassador_percent={tenant.ambassador_split_pool_ambassador_percent}
            currency={tenant.currency}
          />
        </AdminBlockAccent>

        <AdminBlockAccent tone="info">
          <PromoteAmbassadorSection />
        </AdminBlockAccent>

        <AdminBlockAccent tone="success">
          <AmbassadorsListSection
            ambassadors={ambassadorRows}
            payoutThreshold={tenant.ambassador_payout_threshold_amount}
            currency={tenant.currency}
          />
        </AdminBlockAccent>

        <AdminBlockAccent tone={(commissions ?? []).length > 0 ? 'warning' : 'neutral'}>
          <CommissionsSection initialCommissions={commissions ?? []} currency={tenant.currency} />
        </AdminBlockAccent>
      </div>
    </div>
  );
}
