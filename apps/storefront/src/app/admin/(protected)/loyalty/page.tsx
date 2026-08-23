import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getStuckSignupBonuses } from '@/lib/loyalty/getStuckSignupBonuses';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { LoyaltyConfigSection } from './LoyaltyConfigSection';
import { ReferralAccessSection } from './ReferralAccessSection';
import { PendingReviewSection } from './PendingReviewSection';
import { StuckSignupBonusSection } from './StuckSignupBonusSection';
import type { PointsLedgerEntry, TenantReferralTier } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminLoyaltyPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();

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

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Fidélité & parrainage"
        description="Configurez le programme, gérez les accès et traitez les éléments qui nécessitent une revue manuelle."
        meta={tenant.loyalty_enabled ? 'Programme actif' : 'Programme désactivé'}
      />

      <div className="space-y-6">
        <AdminBlockAccent tone="primary">
          <LoyaltyConfigSection
            loyalty_enabled={tenant.loyalty_enabled}
            referral_max_depth={tenant.referral_max_depth}
            purchase_points_rate={tenant.purchase_points_rate}
            referral_availability_mode={tenant.referral_availability_mode}
            referral_unlock_spending_threshold={tenant.referral_unlock_spending_threshold}
            referral_fraud_max_conversions={tenant.referral_fraud_max_conversions}
            referral_fraud_period_days={tenant.referral_fraud_period_days}
            referral_fraud_action={tenant.referral_fraud_action}
            initialTiers={(tiers ?? []) as TenantReferralTier[]}
          />
        </AdminBlockAccent>

        <AdminBlockAccent tone="info">
          <ReferralAccessSection />
        </AdminBlockAccent>

        <AdminBlockAccent tone={(pendingEntries ?? []).length > 0 ? 'warning' : 'neutral'}>
          <PendingReviewSection initialEntries={(pendingEntries ?? []) as PointsLedgerEntry[]} />
        </AdminBlockAccent>

        <AdminBlockAccent tone={stuckSignupBonuses.length > 0 ? 'warning' : 'neutral'}>
          <StuckSignupBonusSection initialItems={stuckSignupBonuses} />
        </AdminBlockAccent>
      </div>
    </div>
  );
}
