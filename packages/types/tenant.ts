export type ShippingProvider = 'packlink' | 'flat_rate' | 'pickup_only';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logo_url: string | null;
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
  active: boolean;
  // Spedizione
  shipping_provider: ShippingProvider;
  packlink_api_key: string | null;   // null = usa env PACKLINK_API_KEY
  flat_rate_amount: number | null;   // usato solo se shipping_provider = 'flat_rate'
  created_at: string;
  updated_at: string;
}
