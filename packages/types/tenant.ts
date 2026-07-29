import type { ReferralAvailabilityMode, ReferralFraudAction } from './loyalty';

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
  click_collect_enabled: boolean;
  click_collect_address: string | null;
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
  ai_chatbox_enabled: boolean;
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
  created_at: string;
  updated_at: string;
}
