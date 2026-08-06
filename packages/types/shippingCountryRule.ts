export type ShippingDiscountType = 'percentage' | 'fixed';

export interface ShippingCountryRuleRow {
  id: string;
  tenant_id: string;
  countries: string[];
  free_shipping_above: number | null;
  flat_rate_override: number | null;
  discount_type: ShippingDiscountType | null;
  discount_value: number | null;
  active: boolean;
  position: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}
