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
  created_at: string;
  updated_at: string;
}
