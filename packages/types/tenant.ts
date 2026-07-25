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
  created_at: string;
  updated_at: string;
}
