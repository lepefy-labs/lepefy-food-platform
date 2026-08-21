export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string; slug: string; name: string; tagline: string | null;
          logo_url: string | null; primary_color: string; secondary_color: string;
          accent_light: string; city: string | null; country: string; currency: string;
          locale: string; stripe_account_id: string | null; click_collect_enabled: boolean;
          click_collect_address: string | null; google_maps_url: string | null; click_collect_hours_it: string | null; active: boolean; storefront_ready: boolean; show_powered_by: boolean; created_at: string; updated_at: string;
          subscription_status: 'active' | 'expired';
          subscription_paid_until: string | null;
          stripe_payment_link: string | null;
          bank_iban: string | null;
          bank_beneficiary: string | null;
          bank_bic: string | null;
        };
        Insert: Partial<Database['public']['Tables']['tenants']['Row']> & { slug: string; name: string };
        Update: Partial<Database['public']['Tables']['tenants']['Row']>;
      };
      categories: {
        Row: { id: string; tenant_id: string; name: string; slug: string; image_url: string | null; position: number; created_at: string };
        Insert: Omit<Database['public']['Tables']['categories']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['categories']['Row']>;
      };
      products: {
        Row: {
          id: string; tenant_id: string; category_id: string | null; name: string; slug: string;
          description: string | null; price: number; compare_at_price: number | null;
          image_url: string | null; images: Json; weight_grams: number | null; stock: number;
          active: boolean; featured: boolean; position: number; created_at: string; updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['products']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['products']['Row']>;
      };
      orders: {
        Row: {
          id: string; tenant_id: string; customer_id: string | null; email: string; full_name: string | null;
          fulfillment_type: string; shipping_address: Json | null; subtotal: number; shipping_cost: number;
          total: number; payment_method: string | null; payment_status: string;
          stripe_payment_intent_id: string | null; status: string; tracking_code: string | null;
          tracking_carrier: string | null; shipped_at: string | null; notes: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['orders']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['orders']['Row']>;
      };
      shipping_zones: {
        Row: { id: string; tenant_id: string; name: string; countries: string[]; free_above: number | null; active: boolean; position: number; created_at: string };
        Insert: Omit<Database['public']['Tables']['shipping_zones']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['shipping_zones']['Row']>;
      };
      shipping_rates: {
        Row: { id: string; tenant_id: string; zone_id: string; min_weight_g: number; max_weight_g: number | null; rate: number; active: boolean; position: number; created_at: string };
        Insert: Omit<Database['public']['Tables']['shipping_rates']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['shipping_rates']['Row']>;
      };
    };
  };
}
