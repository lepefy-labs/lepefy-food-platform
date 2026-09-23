export interface ShippingPackagingProfileRow {
  id: string;
  tenant_id: string;
  name: string;
  box_length_cm: number;
  box_width_cm: number;
  box_height_cm: number;
  max_weight_g: number;
  /** Migration 123 — tranche de poids par colis (g) où ce carton est suggéré en préparation.
   *  Absent tant que la migration n'est pas appliquée ; null = jamais suggéré. */
  suggest_min_weight_g?: number | null;
  suggest_max_weight_g?: number | null;
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

/**
 * initial  : « Couverture initiale » — ~6 poids par profil, calés sur sa capacité ;
 * deep     : « Analyse approfondie » — densifiée autour des paliers tarifaires et
 *            des seuils de passage à plusieurs colis ;
 * manual   : poids saisis librement (appliqués à chaque profil) ;
 * resample : campagne de remesure — items = sous-ensemble explicite, pas le produit cartésien.
 */
export type ShippingSamplingMode = 'initial' | 'deep' | 'manual' | 'resample';

export interface ShippingScenarioDestination {
  country: string;
  /** Toujours une chaîne : les zéros initiaux sont significatifs. */
  postalCode: string;
  zoneCode?: string | null;
  label?: string;
  /** Contexte géographique conservé depuis la sélection de ville (optionnel pour les CAP manuels). */
  city?: string;
  adminCode1?: string | null;
  adminCode2?: string | null;
  adminName?: string;
}

export interface ShippingScenarioMatrix {
  /** Union des poids (compatibilité + affichage). */
  weightsKg: number[];
  /** Poids par profil (modes initial/deep) — prioritaire sur weightsKg quand présent. */
  weightsByProfileId?: Record<string, number[]>;
  packagingProfileIds: string[];
  destinations: ShippingScenarioDestination[];
  freshnessWindowDays?: number;
  samplingMode?: ShippingSamplingMode;
  /** Campagne d'origine pour une remesure. */
  sourceCampaignId?: string;
  /** Partie k/N d'une couverture découpée de façon déterministe. */
  part?: { index: number; count: number };
  /** 'zone_sentinels' : CAP témoins choisis automatiquement par zone tarifaire. */
  destinationMode?: 'postal' | 'zone_sentinels';
  sentinelsPerZone?: number;
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

/**
 * weight_bands_whole_order     : bande appliquée au poids total de la commande ;
 * first_parcel_plus_discounted : 1er colis au prix de sa bande + montant fixe par colis supplémentaire ;
 * first_parcel_plus_percentage : 1er colis au prix de sa bande + chaque colis supplémentaire au prix
 *                                de SA bande moins percentageDiscount % ;
 * flat_multi_parcel_rate       : prix unique dès 2 colis.
 * Avec parcelMaxKg, les colis sont remplis jusqu'à parcelMaxKg (le 1er est le plus lourd).
 */
export type ShippingMultiParcelStrategyType =
  | 'weight_bands_whole_order' | 'first_parcel_plus_discounted' | 'first_parcel_plus_percentage' | 'flat_multi_parcel_rate';

export interface ShippingMultiParcelStrategy {
  type: ShippingMultiParcelStrategyType;
  discountedParcelRate?: number;
  /** 0–100 : remise en % sur chaque colis supplémentaire. */
  percentageDiscount?: number;
  flatMultiParcelRate?: number;
  /** Poids max par colis pour le découpage (ex. 15). */
  parcelMaxKg?: number;
  /** Surcharge de zone appliquée une fois par commande (défaut) ou à chaque colis. */
  zoneSurchargeMode?: 'per_order' | 'per_parcel';
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
