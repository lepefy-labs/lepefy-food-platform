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
  active: boolean;
  ai_image_generation: boolean;
  catalogue_search_threshold: number;
  // Spedizione
  shipping_provider: ShippingProvider;
  packlink_api_key: string | null;
  flat_rate_amount: number | null;
  show_powered_by: boolean;
  created_at: string;
  updated_at: string;
}
