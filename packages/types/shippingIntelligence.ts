export interface ShippingPackagingProfileRow {
  id: string;
  tenant_id: string;
  name: string;
  box_length_cm: number;
  box_width_cm: number;
  box_height_cm: number;
  max_weight_g: number;
  is_default: boolean;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ShippingZoneRow {
  id: string;
  tenant_id: string;
  code: string;
  country: string;
  postal_prefixes: string[];
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export type ShippingObservationSource = 'synthetic_simulation' | 'real_quote' | 'real_shipment';

export interface ShippingObservationParcel {
  weight_g: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
}

export interface ShippingQuoteObservationRow {
  id: string;
  tenant_id: string;
  provider: string;
  source: ShippingObservationSource;
  campaign_id: string | null;
  origin_country: string;
  origin_postal_code: string;
  destination_country: string;
  destination_postal_code: string;
  destination_zone_code: string | null;
  num_parcels: number;
  parcels: ShippingObservationParcel[];
  total_weight_g: number;
  packaging_profile_id: string | null;
  service_id: string | null;
  carrier: string | null;
  service_name: string | null;
  base_price: number | null;
  tax_price: number | null;
  total_provider_cost: number | null;
  eligible: boolean;
  exclusion_reason: string | null;
  observed_at: string;
  request_hash: string;
  created_at: string;
}

export type ShippingCampaignStatus =
  | 'draft' | 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'cancelled';

export interface ShippingScenarioMatrix {
  weightsKg: number[];
  packagingProfileIds: string[];
  destinations: Array<{ country: string; postalCode: string; zoneCode?: string | null; label?: string }>;
  freshnessWindowDays?: number;
}

export interface ShippingSimulationCampaignRow {
  id: string;
  tenant_id: string;
  name: string;
  status: ShippingCampaignStatus;
  scenario_matrix: ShippingScenarioMatrix;
  concurrency_limit: number;
  total_scenarios: number;
  completed_scenarios: number;
  failed_scenarios: number;
  skipped_scenarios: number;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export type ShippingCampaignItemStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped_duplicate';

export interface ShippingCampaignItemScenario {
  weightKg: number;
  packagingProfileId: string;
  destination: { country: string; postalCode: string; zoneCode?: string | null };
}

export interface ShippingSimulationCampaignItemRow {
  id: string;
  campaign_id: string;
  tenant_id: string;
  scenario: ShippingCampaignItemScenario;
  status: ShippingCampaignItemStatus;
  observation_id: string | null;
  error: string | null;
  attempted_at: string | null;
  created_at: string;
}

export interface ShippingTariffBand {
  minKg: number;
  maxKg: number | null;
  price: number;
}

export type ShippingMultiParcelStrategyType = 'weight_bands_whole_order' | 'first_parcel_plus_discounted' | 'flat_multi_parcel_rate';

export interface ShippingMultiParcelStrategy {
  type: ShippingMultiParcelStrategyType;
  discountedParcelRate?: number;
  flatMultiParcelRate?: number;
}

export interface ShippingTariffDraftRow {
  id: string;
  tenant_id: string;
  name: string;
  status: 'draft' | 'archived';
  bands: ShippingTariffBand[];
  zone_surcharges: Record<string, number>;
  multi_parcel_strategy: ShippingMultiParcelStrategy | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
