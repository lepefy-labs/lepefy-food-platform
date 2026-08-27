import { createServiceClient } from '@/lib/supabase/server';

export interface TenantBillingFeature {
  key: string;
  label: string;
  position: number;
}

export interface TenantBillingSnapshot {
  planCode: string;
  planName: string;
  monthlyPriceCents: number;
  currency: string;
  status: 'active' | 'expired';
  paidUntil: string | null;
  stripePaymentLink: string | null;
  features: TenantBillingFeature[];
  bankIban: string | null;
  bankBeneficiary: string | null;
  bankBic: string | null;
  supportEmail: string;
  source: 'platform_billing' | 'legacy_tenant';
}

interface LegacyTenantBilling {
  id: string;
  subscription_status: string | null;
  subscription_paid_until: string | null;
  stripe_payment_link: string | null;
  bank_iban: string | null;
  bank_beneficiary: string | null;
  bank_bic: string | null;
}

const LEGACY_FEATURES: TenantBillingFeature[] = [
  { key: 'shop', label: 'Boutique', position: 10 },
  { key: 'events', label: 'Événementiel', position: 20 },
  { key: 'digital_card', label: 'Carte digitale', position: 30 },
  { key: 'ai', label: 'Intelligence IA', position: 40 },
];

export async function getTenantBillingSnapshot(tenant: LegacyTenantBilling): Promise<TenantBillingSnapshot> {
  // New schema is intentionally queried through the service client before generated DB types catch up.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;

  const { data: subscription, error: subscriptionError } = await service
    .from('tenant_subscriptions')
    .select('plan_id, status, paid_until, stripe_payment_link')
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!subscriptionError && subscription) {
    const [{ data: plan }, { data: features }, { data: platformSettings }] = await Promise.all([
      service.from('platform_plans').select('code, name, monthly_price_cents, currency').eq('id', subscription.plan_id).single(),
      service.from('platform_plan_features').select('feature_key, label, position').eq('plan_id', subscription.plan_id).order('position', { ascending: true }),
      service.from('platform_billing_settings').select('bank_iban, bank_beneficiary, bank_bic, support_email').eq('id', 'default').maybeSingle(),
    ]);

    if (plan) {
      return {
        planCode: plan.code,
        planName: plan.name,
        monthlyPriceCents: Number(plan.monthly_price_cents) || 0,
        currency: plan.currency || 'EUR',
        status: subscription.status === 'expired' ? 'expired' : 'active',
        paidUntil: subscription.paid_until,
        stripePaymentLink: subscription.stripe_payment_link,
        features: (features ?? []).map((feature: { feature_key: string; label: string; position: number | null }) => ({
          key: feature.feature_key,
          label: feature.label,
          position: feature.position ?? 0,
        })),
        bankIban: platformSettings?.bank_iban ?? null,
        bankBeneficiary: platformSettings?.bank_beneficiary ?? null,
        bankBic: platformSettings?.bank_bic ?? null,
        supportEmail: platformSettings?.support_email ?? 'support@lepefy.com',
        source: 'platform_billing',
      };
    }
  }

  // Compatibility fallback: keeps tenant billing operational until migration 084 is applied.
  return {
    planCode: 'legacy-food-platform',
    planName: 'Lepefy Food Platform',
    monthlyPriceCents: 8900,
    currency: 'EUR',
    status: tenant.subscription_status === 'expired' ? 'expired' : 'active',
    paidUntil: tenant.subscription_paid_until,
    stripePaymentLink: tenant.stripe_payment_link,
    features: LEGACY_FEATURES,
    bankIban: tenant.bank_iban,
    bankBeneficiary: tenant.bank_beneficiary,
    bankBic: tenant.bank_bic,
    supportEmail: 'support@lepefy.com',
    source: 'legacy_tenant',
  };
}

export function formatPlanPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, minimumFractionDigits: 2 }).format(cents / 100);
}
