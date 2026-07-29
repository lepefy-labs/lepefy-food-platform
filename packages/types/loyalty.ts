export type ReferralAvailabilityMode = 'ALL_CUSTOMERS' | 'SPENDING_THRESHOLD' | 'ADMIN_GRANTED_ONLY';
export type ReferralFraudAction = 'FLAG_FOR_REVIEW' | 'AUTO_BLOCK' | 'CAP_AT_THRESHOLD';
export type ReferralAccessReason = 'DEFAULT_ENABLED' | 'THRESHOLD_MET' | 'ADMIN_GRANTED';

export interface ReferralCode {
  id: string;
  tenant_id: string;
  owner_customer_id: string;
  code: string;
  is_active: boolean;
  max_uses: number | null;
  uses_count: number;
  created_at: string;
}

export interface TenantReferralTier {
  id: string;
  tenant_id: string;
  level: number;
  pct: number;
  is_active: boolean;
  effective_from: string;
  created_by: string | null;
}

export type PointsLedgerStatus = 'PENDING' | 'CONFIRMED' | 'SPENT' | 'EXPIRED' | 'REVERSED';
export type PointsLedgerTransactionType =
  | 'PURCHASE_EARNED'
  | 'REFERRAL_EARNED'
  | 'SIGNUP_BONUS'
  | 'REDEEMED'
  | 'EXPIRED'
  | 'REVERSED';

export interface PointsLedgerEntry {
  id: string;
  tenant_id: string;
  customer_id: string;
  amount: number;
  status: PointsLedgerStatus;
  transaction_type: PointsLedgerTransactionType;
  referral_level: number | null;
  pct_applied: number | null;
  reference_order_id: string | null;
  reference_customer_id: string | null;
  reversal_of_ledger_id: string | null;
  requires_manual_review: boolean;
  notes: string | null;
  created_at: string;
}

export interface CustomerPointsBalance {
  tenant_id: string;
  customer_id: string;
  confirmed_balance: number;
  pending_balance: number;
}

export type ReferralFraudSignalType = 'SAME_IP' | 'SAME_DEVICE' | 'SAME_SHIPPING_ADDRESS' | 'SAME_PHONE';

export interface ReferralFraudSignal {
  id: string;
  tenant_id: string;
  customer_id: string;
  signal_type: ReferralFraudSignalType;
  matched_customer_id: string;
  detected_at: string;
}

export interface ReferralChainNode {
  customerId: string;
  level: number;
}
