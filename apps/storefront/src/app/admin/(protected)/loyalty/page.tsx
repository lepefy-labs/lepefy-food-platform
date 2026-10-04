import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getStuckSignupBonuses } from '@/lib/loyalty/getStuckSignupBonuses';
import { getLoyaltySettings } from '@/lib/loyalty/loyaltyConfig';
import { getReferralSettings, REFERRAL_UNAVAILABLE_VIEW } from '@/lib/loyalty/referralConfig';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { LoyaltyConfigSection } from './LoyaltyConfigSection';
import { ReferralAccessSection } from './ReferralAccessSection';
import { PendingReviewSection } from './PendingReviewSection';
import { StuckSignupBonusSection } from './StuckSignupBonusSection';
import type { PointsLedgerEntry, TenantReferralTier } from '@lepefy/types';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminLoyaltyPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const [loyalty, referralSettings, access] = await Promise.all([
    getLoyaltySettings(supabase, tenant.id),
    getReferralSettings(supabase, tenant.id),
    getCurrentAdminAccessContext(tenant.id),
  ]);
  // UI hint only: PATCH loyalty/settings and loyalty/referral re-check tenant_settings.manage.
  const canEditSettings = Boolean(access && canAdmin(access, 'tenant_settings.manage'));
  const referral = referralSettings ?? REFERRAL_UNAVAILABLE_VIEW;

  const [{ data: tiers }, { data: pendingEntries }, stuckSignupBonuses] = await Promise.all([
    supabase
      .from('tenant_referral_tiers')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('level', { ascending: true })
      .order('effective_from', { ascending: false }),
    supabase
      .from('points_ledger')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('requires_manual_review', true)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false }),
    getStuckSignupBonuses(tenant.id),
  ]);

  // Names for the review rows: one tenant-scoped query for every customer involved.
  const entries = (pendingEntries ?? []) as PointsLedgerEntry[];
  const customerIds = [...new Set(entries.flatMap((entry) => [entry.customer_id, entry.reference_customer_id]).filter((id): id is string => Boolean(id)))];
  const { data: reviewCustomers } = customerIds.length > 0
    ? await supabase.from('customers').select('id, full_name, email').eq('tenant_id', tenant.id).in('id', customerIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const customerNames = Object.fromEntries((reviewCustomers ?? []).map((customer) => [customer.id, customer.full_name || customer.email || 'Client']));

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Fidélité & parrainage"
        description="Configurez le programme, gérez les accès et traitez les éléments qui nécessitent une revue manuelle."
        meta={loyalty.enabled ? 'Programme actif' : 'Programme désactivé'}
      />

      <div className="space-y-6">
        <AdminBlockAccent tone="primary">
          <LoyaltyConfigSection
            loyalty_enabled={loyalty.enabled}
            referral_max_depth={referral.referral_max_depth}
            purchase_points_rate={loyalty.purchasePointsRate}
            referral_availability_mode={referral.referral_availability_mode}
            referral_unlock_spending_threshold={referral.referral_unlock_spending_threshold}
            referral_fraud_max_conversions={referral.referral_fraud_max_conversions}
            referral_fraud_period_days={referral.referral_fraud_period_days}
            referral_fraud_action={referral.referral_fraud_action}
            initialTiers={(tiers ?? []) as TenantReferralTier[]}
            canEditSettings={canEditSettings}
          />
        </AdminBlockAccent>

        <AdminBlockAccent tone="info">
          <ReferralAccessSection />
        </AdminBlockAccent>

        <AdminBlockAccent tone={entries.length > 0 ? 'warning' : 'neutral'}>
          <PendingReviewSection initialEntries={entries} customerNames={customerNames} />
        </AdminBlockAccent>

        <AdminBlockAccent tone={stuckSignupBonuses.length > 0 ? 'warning' : 'neutral'}>
          <StuckSignupBonusSection initialItems={stuckSignupBonuses} />
        </AdminBlockAccent>
      </div>
    </div>
  );
}
