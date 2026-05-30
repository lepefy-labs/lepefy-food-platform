import type { ShippingCalculationInput, ShippingCalculationResult, ShippingRate, ShippingZone } from '@lepefy/types';

const WEIGHT_FALLBACK_G = 400;

export function calculateShipping(
  input: ShippingCalculationInput,
  zones: ShippingZone[],
  rates: ShippingRate[],
): ShippingCalculationResult | null {
  const totalWeightG = input.cartItems.reduce((sum, item) => {
    return sum + (item.weightGrams ?? WEIGHT_FALLBACK_G) * item.quantity;
  }, 0);

  const zone = zones.find((z) => z.active && z.countries.includes(input.destinationCountry));
  if (!zone) return null;

  if (zone.free_above !== null && input.cartTotal >= zone.free_above) {
    return { rate: 0, zoneName: zone.name, isFree: true, totalWeightG };
  }

  const matchingRate = rates
    .filter((r) => r.zone_id === zone.id && r.active)
    .sort((a, b) => a.min_weight_g - b.min_weight_g)
    .find((r) => totalWeightG >= r.min_weight_g && (r.max_weight_g === null || totalWeightG <= r.max_weight_g));

  if (!matchingRate) return null;
  return { rate: matchingRate.rate, zoneName: zone.name, isFree: false, totalWeightG };
}
