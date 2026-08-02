import type { ReferralAccessReason } from './loyalty';
import type { AmbassadorPaymentMethod } from './ambassador';

export interface Customer {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  // Carta fedeltà virtuale (047)
  loyalty_card_number: string | null;
  // Loyalty & referral
  referred_by_id: string | null;
  signup_ip: string | null;
  signup_device_fingerprint: string | null;
  referral_access_granted: boolean;
  referral_access_reason: ReferralAccessReason | null;
  referral_access_granted_at: string | null;
  referral_access_granted_by: string | null;
  referral_suspended: boolean;
  // Ambassador
  is_ambassador: boolean;
  promoted_to_ambassador_at: string | null;
  promoted_to_ambassador_by: string | null;
  ambassador_first_name: string | null;
  ambassador_last_name: string | null;
  ambassador_payment_method: AmbassadorPaymentMethod | null;
  ambassador_iban: string | null;
  ambassador_paypal_email: string | null;
  ambassador_profile_completed_at: string | null;
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
