import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { formatBarcodeDisplay } from '@/lib/barcode';
import { getLoyaltyBrand } from '@/lib/loyalty/wallet/brand';
import { getWalletAvailability } from '@/lib/loyalty/wallet/config';
import { contrastRatio, mixWithBlack } from '@/lib/utils/color';
import { requireTermsConsentOrRedirect } from '@/lib/legal/requireTermsConsentOrRedirect';
import { generateTrackingToken } from '@/lib/tracking/generateTrackingToken';
import { accountReferralState, type AccountOrderSummary } from '@/lib/account/dashboard';
import type { Address } from '@lepefy/types';
import { AccountDashboard } from './AccountDashboard';
import { canShowPublicReviews } from '@/lib/reviews/publicReviewData';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ComptePage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const customer = await getSessionCustomer(tenant.id);
  if (!customer) redirect('/compte/connexion');
  await requireTermsConsentOrRedirect(tenant.id, customer.id, '/compte');

  const supabase = createServiceClient();
  const [member, addresses, points, orders, reviewsAvailable] = await Promise.all([
    supabase.from('customers')
      .select('full_name, phone, loyalty_card_number, is_ambassador, ambassador_profile_completed_at, referral_access_granted, referral_suspended')
      .eq('tenant_id', tenant.id).eq('id', customer.id).single(),
    supabase.from('addresses').select('*')
      .eq('tenant_id', tenant.id).eq('customer_id', customer.id)
      .order('is_default', { ascending: false }).order('created_at', { ascending: false }),
    tenant.loyalty_enabled
      ? supabase.from('customer_points_balance').select('confirmed_balance')
        .eq('tenant_id', tenant.id).eq('customer_id', customer.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('orders').select('id, status, created_at, total, email, fulfillment_type')
      .eq('tenant_id', tenant.id).eq('customer_id', customer.id)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
    canShowPublicReviews(tenant.id),
  ]);
  // Core profile failure must not silently downgrade an ambassador or invent
  // referral eligibility. Other sections fail independently and can retry.
  if (member.error || !member.data) throw new Error('Unable to load account profile');
  const row = member.data;
  const lastOrder = orders.data;
  let latestOrder: AccountOrderSummary | null = null;
  let orderError = !!orders.error;
  if (!orderError && lastOrder) {
    try {
      latestOrder = {
        id: lastOrder.id, status: lastOrder.status, createdAt: lastOrder.created_at,
        total: Number(lastOrder.total),
        fulfillmentType: lastOrder.fulfillment_type === 'pickup' ? 'pickup' : 'delivery',
        trackingToken: generateTrackingToken(lastOrder.id, lastOrder.email),
      };
    } catch { orderError = true; }
  }
  const brand = getLoyaltyBrand(tenant);
  const wallets = tenant.loyalty_enabled ? getWalletAvailability(tenant.slug, tenant.logo_url) : { google: false, apple: false };
  const primaryDarkApprox = mixWithBlack(tenant.primary_color, 75);
  const accountAccentForeground = contrastRatio(tenant.accent_light, primaryDarkApprox) >= 3 ? primaryDarkApprox : '#374151';
  const cardNumber = row.loyalty_card_number ?? null;

  return (
    <AccountDashboard
      tenant={{ name: tenant.name, loyaltyEnabled: tenant.loyalty_enabled, currency: tenant.currency }}
      email={customer.email}
      fullName={row.full_name ?? customer.full_name}
      phone={row.phone}
      confirmedPoints={points.error ? null : points.data?.confirmed_balance ?? 0}
      addresses={(addresses.data ?? []) as Address[]}
      isAmbassador={row.is_ambassador ?? false}
      ambassadorProfileCompleted={!!row.ambassador_profile_completed_at}
      loyaltyCardNumberDisplay={cardNumber ? formatBarcodeDisplay(cardNumber) : null}
      loyaltyBrand={brand}
      walletAvailable={wallets.google || wallets.apple}
      accountAccentForeground={accountAccentForeground}
      latestOrder={latestOrder}
      reviewsAvailable={reviewsAvailable}
      errors={{ points: !!points.error, addresses: !!addresses.error, orders: orderError }}
      referral={{
        state: accountReferralState(tenant.loyalty_enabled, row.referral_access_granted, row.referral_suspended),
        mode: tenant.referral_availability_mode,
        threshold: tenant.referral_unlock_spending_threshold,
      }}
    />
  );
}
