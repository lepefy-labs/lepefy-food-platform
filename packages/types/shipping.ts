export interface ShippingZone {
  id: string;
  tenant_id: string;
  name: string;
  countries: string[];
  free_above: number | null;
  active: boolean;
  position: number;
  created_at: string;
}

export interface ShippingRate {
  id: string;
  tenant_id: string;
  zone_id: string;
  min_weight_g: number;
  max_weight_g: number | null;
  rate: number;
  active: boolean;
  created_at: string;
}

export interface ShippingCalculationInput {
  tenantId: string;
  cartItems: Array<{ weightGrams: number | null; quantity: number }>;
  destinationCountry: string;
  cartTotal: number;
}

export interface ShippingCalculationResult {
  rate: number;
  zoneName: string;
  isFree: boolean;
  totalWeightG: number;
}
