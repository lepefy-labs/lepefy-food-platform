import type { TariffSnapshot } from '../../../src/lib/shipping/tariff/priceFromTariff';

/** Griglia pilota ChloeFood (template, non costanti del motore). */
export const CHLOEFOOD_TARIFF: TariffSnapshot = {
  id: 'v-chloe-1',
  version: 1,
  country: 'IT',
  currency: 'EUR',
  bands: [
    { min_g_exclusive: 0, max_g_inclusive: 5000, price_cents: 840 },
    { min_g_exclusive: 5000, max_g_inclusive: 10000, price_cents: 1080 },
    { min_g_exclusive: 10000, max_g_inclusive: 15000, price_cents: 1260 },
    { min_g_exclusive: 15000, max_g_inclusive: 20000, price_cents: 1640 },
    { min_g_exclusive: 20000, max_g_inclusive: 30000, price_cents: 1980 },
  ],
  zoneSurcharges: [
    { zone_code: 'IT_SICILY', amount_cents: 200, mode: 'per_parcel' },
    { zone_code: 'IT_SARDINIA', amount_cents: 200, mode: 'per_parcel' },
    { zone_code: 'IT_CALABRIA', amount_cents: 200, mode: 'per_parcel' },
  ],
  nonDeliverableZones: ['IT_EXTRA_CUSTOMS'],
  maxParcelWeightG: 15000,
  blockWeightG: 30000,
  blockPriceCents: 1980,
  logisticsVerifiedMaxWeightG: 50000,
  pricesIncludeVat: true,
};
