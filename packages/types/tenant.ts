import type { ReferralAvailabilityMode, ReferralFraudAction } from './loyalty';
import type { AmbassadorCommissionMode, AmbassadorDiscountType } from './ambassador';

export type ShippingProvider = 'packlink' | 'flat_rate' | 'pickup_only';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logo_url: string | null;
  hero_image_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_light: string;
  city: string | null;
  country: string;
  currency: string;
  locale: string;
  stripe_account_id: string | null;
  storefront_url: string | null;
  click_collect_enabled: boolean;
  click_collect_address: string | null;
  google_maps_url: string | null;
  click_collect_hours: string | null;
  click_collect_hours_it: string | null;
  whatsapp_number: string | null;
  label_logo_url: string | null;
  legal_name: string | null;
  legal_address: string | null;
  legal_email: string | null;
  legal_website: string | null;
  active: boolean;
  storefront_ready: boolean;
  ai_image_generation: boolean;
  locales: string[];
  ai_description_generation: boolean;
  ai_rate_limit_public_per_minute: number;
  ai_rate_limit_public_per_day: number;
  ai_rate_limit_admin_per_day: number;
  ai_semantic_search: boolean;
  chatbox_extra_context: string | null;
  catalogue_search_threshold: number;
  // Spedizione
  shipping_provider: ShippingProvider;
  packlink_api_key: string | null;
  flat_rate_amount: number | null;
  show_powered_by: boolean;
  // Sezione "Notre origine" (home)
  story_heading: string | null;
  story_text: string | null;
  story_image_url: string | null;
  countries_served: number | null;
  // Loyalty & referral
  loyalty_enabled: boolean;
  referral_max_depth: number;
  purchase_points_rate: number;
  points_to_currency_rate: number;
  referral_signup_bonus_points: number;
  referral_fraud_max_conversions: number;
  referral_fraud_period_days: number;
  referral_fraud_action: ReferralFraudAction;
  referral_availability_mode: ReferralAvailabilityMode;
  referral_unlock_spending_threshold: number | null;
  // Ambassador (commissioni + sconto primo ordine)
  ambassador_min_purchase_amount: number;
  ambassador_min_commission_amount: number;
  ambassador_max_commission_amount: number;
  ambassador_loyalty_from_second_order: boolean;
  ambassador_first_order_discount_type: AmbassadorDiscountType | null;
  ambassador_first_order_discount_value: number | null;
  ambassador_payout_threshold_amount: number;
  ambassador_commission_mode: AmbassadorCommissionMode;
  ambassador_split_pool_amount: number | null;
  ambassador_split_pool_ambassador_percent: number | null;
  // Android app (TWA / Digital Asset Links)
  android_package_name: string | null;
  android_sha256_fingerprint: string | null;
  android_public: boolean;
  // Module Événementiel (052)
  events_enabled: boolean;
  services_enabled: boolean;
  created_at: string;
  updated_at: string;
}
