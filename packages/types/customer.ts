import type { ReferralAccessReason } from './loyalty';

export interface Customer {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  // Loyalty & referral
  referred_by_id: string | null;
  signup_ip: string | null;
  signup_device_fingerprint: string | null;
  referral_access_granted: boolean;
  referral_access_reason: ReferralAccessReason | null;
  referral_access_granted_at: string | null;
  referral_access_granted_by: string | null;
  referral_suspended: boolean;
}

export interface Address {
  id: string;
  customer_id: string;
  tenant_id: string;
  full_name: string;
  line1: string;
  line2: string | null;
  city: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  created_at: string;
}
