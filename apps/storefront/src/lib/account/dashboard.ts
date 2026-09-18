import type { ReferralAvailabilityMode } from '@lepefy/types';
import type { FulfillmentKind } from '@/lib/orders/orderStatus';

export interface AccountOrderSummary {
  id: string;
  status: string;
  createdAt: string;
  total: number;
  fulfillmentType: FulfillmentKind;
  trackingToken: string;
}

export type ReferralState = 'eligible' | 'locked' | 'suspended' | 'unavailable';

export interface AccountReferralSummary {
  state: ReferralState;
  mode: ReferralAvailabilityMode;
  threshold: number | null;
}

export function accountReferralState(
  enabled: boolean,
  granted: boolean | null | undefined,
  suspended: boolean | null | undefined,
): ReferralState {
  if (!enabled) return 'unavailable';
  if (suspended) return 'suspended';
  return granted ? 'eligible' : 'locked';
}

export function referralDescription(referral: AccountReferralSummary): string {
  if (referral.state === 'eligible') return 'Partagez votre lien et retrouvez vos invitations.';
  if (referral.state === 'suspended') return 'Votre accès est temporairement suspendu.';
  if (referral.state === 'unavailable') return 'Le programme est actuellement indisponible.';
  return referral.mode === 'SPENDING_THRESHOLD'
    ? 'Consultez les conditions et votre progression.'
    : 'Consultez les conditions d’accès au programme.';
}
