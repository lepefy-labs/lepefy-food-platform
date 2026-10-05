import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { payoutDestination, type AmbassadorSettings } from '@/lib/ambassador/ambassadorAdmin';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { AmbassadorConfigSection } from './AmbassadorConfigSection';
import { PromoteAmbassadorSection } from './PromoteAmbassadorSection';
import { AmbassadorsListSection, type AmbassadorListRow } from './AmbassadorsListSection';
import { PayoutsSection, type PayoutCandidate } from './PayoutsSection';
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

interface PayoutDetailsRow {
  id: string;
  ambassador_payment_method: 'IBAN' | 'PAYPAL' | null;
  ambassador_iban: string | null;
  ambassador_paypal_email: string | null;
}

interface BalanceRow {
  id: string;
  ambassador_customer_id: string | null;
  status: 'CONFIRMED' | 'PAID' | 'CANCELLED';
  commission_amount: number;
}

const COMMISSION_SELECT = '*, ambassador:ambassador_customer_id(email, full_name, ambassador_first_name, ambassador_last_name), referred:referred_customer_id(email, full_name)';

export default async function AdminAmbassadeursPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const access = await getCurrentAdminAccessContext(tenant.id);
  const canManagePayouts = Boolean(access && canAdmin(access, 'growth.payouts.manage'));
  const canEditSettings = Boolean(access && canAdmin(access, 'tenant_settings.manage'));

  const supabase = createServiceClient();

  const [{ data: ambassadors }, { data: balances }, { data: commissions }, { data: payoutDetails }] = await Promise.all([
    supabase
      .from('customers')
      .select('id, email, full_name, ambassador_first_name, ambassador_last_name, ambassador_payment_method, ambassador_profile_completed_at, promoted_to_ambassador_at')
      .eq('tenant_id', tenant.id)
      .eq('is_ambassador', true)
      .order('promoted_to_ambassador_at', { ascending: false }) as unknown as { data: AmbassadorCustomerRow[] | null },
    // One row per referred customer (unique constraint): bounded by the program size.
    supabase
      .from('ambassador_commissions')
      .select('id, ambassador_customer_id, status, commission_amount')
      .eq('tenant_id', tenant.id) as unknown as { data: BalanceRow[] | null },
    supabase
      .from('ambassador_commissions')
      .select(COMMISSION_SELECT)
      .eq('tenant_id', tenant.id)
      .eq('status', 'CONFIRMED')
      .order('created_at', { ascending: false })
      .limit(200) as unknown as { data: CommissionRow[] | null },
    // Bank details are read only for roles that can record a payout.
    canManagePayouts
      ? supabase
        .from('customers')
        .select('id, ambassador_payment_method, ambassador_iban, ambassador_paypal_email')
        .eq('tenant_id', tenant.id)
        .eq('is_ambassador', true) as unknown as Promise<{ data: PayoutDetailsRow[] | null }>
      : Promise.resolve({ data: [] as PayoutDetailsRow[] }),
  ]);

  const byAmbassador = new Map<string, { confirmed: number; paid: number; confirmedIds: string[] }>();
  for (const row of balances ?? []) {
    if (!row.ambassador_customer_id) continue;
    const entry = byAmbassador.get(row.ambassador_customer_id) ?? { confirmed: 0, paid: 0, confirmedIds: [] };
    if (row.status === 'CONFIRMED') {
      entry.confirmed += Number(row.commission_amount);
      entry.confirmedIds.push(row.id);
    }
    if (row.status === 'PAID') entry.paid += Number(row.commission_amount);
    byAmbassador.set(row.ambassador_customer_id, entry);
  }
  const round2 = (value: number) => Math.round(value * 100) / 100;

  const ambassadorRows: AmbassadorListRow[] = (ambassadors ?? []).map((a) => ({
    ...a,
    confirmedBalance: round2(byAmbassador.get(a.id)?.confirmed ?? 0),
    paidTotal: round2(byAmbassador.get(a.id)?.paid ?? 0),
  }));

  const detailsById = new Map((payoutDetails ?? []).map((row) => [row.id, row]));
  const payoutCandidates: PayoutCandidate[] = canManagePayouts
    ? ambassadorRows
      .filter((a) => a.confirmedBalance > 0)
      .map((a) => {
        const details = detailsById.get(a.id);
        return {
          id: a.id,
          email: a.email,
          full_name: a.full_name,
          ambassador_first_name: a.ambassador_first_name,
          ambassador_last_name: a.ambassador_last_name,
          profileComplete: Boolean(a.ambassador_profile_completed_at),
          balance: a.confirmedBalance,
          commissionIds: byAmbassador.get(a.id)?.confirmedIds ?? [],
          destination: details ? payoutDestination(details) : null,
        };
      })
      .sort((x, y) => y.balance - x.balance)
    : [];

  const settings: AmbassadorSettings = {
    ambassador_min_purchase_amount: Number(tenant.ambassador_min_purchase_amount),
    ambassador_min_commission_amount: Number(tenant.ambassador_min_commission_amount),
    ambassador_max_commission_amount: Number(tenant.ambassador_max_commission_amount),
    ambassador_loyalty_from_second_order: tenant.ambassador_loyalty_from_second_order,
    ambassador_first_order_discount_type: tenant.ambassador_first_order_discount_type,
    ambassador_first_order_discount_value: tenant.ambassador_first_order_discount_value == null ? null : Number(tenant.ambassador_first_order_discount_value),
    ambassador_payout_threshold_amount: Number(tenant.ambassador_payout_threshold_amount),
    ambassador_commission_mode: tenant.ambassador_commission_mode,
    ambassador_split_pool_amount: tenant.ambassador_split_pool_amount == null ? null : Number(tenant.ambassador_split_pool_amount),
    ambassador_split_pool_ambassador_percent: tenant.ambassador_split_pool_ambassador_percent == null ? null : Number(tenant.ambassador_split_pool_ambassador_percent),
  };

  const toPay = payoutCandidates.reduce((sum, c) => sum + c.balance, 0);

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Programme Ambassadeur"
        description="Commissions en argent réel pour les clients que vous nommez ambassadeurs, versées manuellement par virement ou PayPal."
        meta={`${ambassadorRows.length} ambassadeur${ambassadorRows.length !== 1 ? 's' : ''}`}
      />

      <div className="space-y-6">
        <AdminBlockAccent tone="primary">
          <AmbassadorConfigSection initialSettings={settings} currency={tenant.currency} canEdit={canEditSettings} />
        </AdminBlockAccent>

        {canManagePayouts && (
          <AdminBlockAccent tone={toPay > 0 ? 'warning' : 'neutral'}>
            <PayoutsSection
              candidates={payoutCandidates}
              payoutThreshold={settings.ambassador_payout_threshold_amount}
              currency={tenant.currency}
            />
          </AdminBlockAccent>
        )}

        <AdminBlockAccent tone="success">
          <AmbassadorsListSection ambassadors={ambassadorRows} currency={tenant.currency} />
        </AdminBlockAccent>

        <AdminBlockAccent tone="info">
          <PromoteAmbassadorSection />
        </AdminBlockAccent>

        <AdminBlockAccent tone="neutral">
          <CommissionsSection key={(commissions ?? []).map((c) => c.id).join(',')} initialCommissions={commissions ?? []} currency={tenant.currency} canManagePayouts={canManagePayouts} />
        </AdminBlockAccent>
      </div>
    </div>
  );
}
