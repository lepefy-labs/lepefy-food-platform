import type { ReferralAvailabilityMode, ReferralFraudAction } from './loyalty';
import type { AmbassadorCommissionMode, AmbassadorDiscountType } from './ambassador';

export type ShippingProvider = 'packlink' | 'flat_rate' | 'pickup_only';

/**
 * Modalità di pricing della spedizione (migration 124), indipendente dal
 * provider logistico. `tariff` (V1G) addebita la versione tariffaria attiva
 * del paese; lo imposta solo l'attivazione esplicita in admin. Assente se la
 * migration non è applicata (= `provider_cost`).
 */
export type ShippingPricingMode = 'provider_cost' | 'shadow' | 'tariff';

/** Modalità tariff (migration 125): comportamento se la tariffa non è applicabile. */
export type ShippingTariffFallback = 'unavailable' | 'provider_cost';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logo_url: string | null;
  app_icon_url: string | null;
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
  google_review_url: string | null;
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
  shipping_pricing_mode?: ShippingPricingMode;
  shipping_tariff_fallback?: ShippingTariffFallback;
  /** Migration 125 — pagina pubblica /livraison visibile (default false). */
  shipping_public_grid_enabled?: boolean;
  show_powered_by: boolean;
  // Sezione "Notre origine" (home)
  story_heading: string | null;
  story_text: string | null;
  story_image_url: string | null;
  countries_served: number | null;
  // Referral (loyalty program settings: tenant_feature_settings 'loyalty', migrations 130/131)
  referral_max_depth: number;
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
  // Livraison location matériel (114)
  rental_delivery_enabled: boolean;
  rental_delivery_countries: string[] | null;
  created_at: string;
  updated_at: string;
}

/**
 * Explicit allow-list of tenant fields that may reach the browser (Client
 * Component props, TenantProvider, RSC payloads). Everything else — provider
 * keys, private assistant context, billing, anti-fraud thresholds, internal
 * limits, sequences — stays server-only. Adding a field here publishes it to
 * every visitor: add only public branding/storefront data.
 */
export const PUBLIC_TENANT_FIELDS = [
  'id',
  'slug',
  'name',
  'tagline',
  'logo_url',
  'app_icon_url',
  'hero_image_url',
  'primary_color',
  'secondary_color',
  'accent_light',
  'city',
  'country',
  'currency',
  'locale',
  'locales',
  'storefront_url',
  'click_collect_enabled',
  'click_collect_address',
  'click_collect_hours',
  'click_collect_hours_it',
  'google_maps_url',
  'whatsapp_number',
  'legal_name',
  'legal_address',
  'legal_email',
  'legal_website',
  'show_powered_by',
  'events_enabled',
  'services_enabled',
] as const satisfies ReadonlyArray<keyof Tenant>;

export type PublicTenant = Pick<Tenant, (typeof PUBLIC_TENANT_FIELDS)[number]>;
