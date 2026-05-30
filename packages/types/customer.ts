export interface Customer {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
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
