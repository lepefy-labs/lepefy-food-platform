/**
 * calculateShipping.ts
 *
 * Formula:
 *   packagingTotal  = surcharge_amount × num_pacchi   (se mode = 'per_parcel')
 *   packagingTotal  = surcharge_amount                (se mode = 'per_order')
 *   shippingTotal   = (packlink_price × (1 + vat_rate)) + packagingTotal
 *
 * Tutto configurabile in DB — zero modifiche al codice per cambiare importi o logica.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SurchargeMode = 'per_parcel' | 'per_order';

export interface PackagingSurcharge {
  surcharge_amount: number;
  surcharge_mode:   SurchargeMode;
  max_pack_kg:      number;
}

export interface VatRate {
  countries: string[];
  vat_rate:  number;
}

export interface ShippingAddress {
  country:  string;
  zip_code: string;
}

export interface ShippingInput {
  cartItems: Array<{ weight_grams: number | null; quantity: number }>;
  from:               ShippingAddress;
  to:                 ShippingAddress;
  packagingSurcharge: PackagingSurcharge;
  vatRates:           VatRate[];
}

export type ShippingResult =
  | {
      available: true;
      shippingTotal: number;
      _internal: {
        totalWeightG:           number;
        numParcels:             number;
        packlinkCost:           number;
        vatRate:                number;
        vatAmount:              number;
        surchargeMode:          SurchargeMode;
        packagingSurchargeTotal: number;
      };
    }
  | {
      available: false;
      reason:  'packlink_error' | 'no_service';
      message: string;
    };

// ─── Constants ────────────────────────────────────────────────────────────────

const PACKLINK_API_BASE = 'https://apisandbox.packlink.com/v1'; // prod: https://api.packlink.com/v1
const WEIGHT_FALLBACK_G = 400;

// ─── Packlink ─────────────────────────────────────────────────────────────────

interface PacklinkParcel {
  weight: number; height: number; width: number; length: number;
}

async function fetchPacklinkCost(
  apiKey: string,
  from: ShippingAddress,
  to: ShippingAddress,
  parcels: PacklinkParcel[],
): Promise<{ cost: number; serviceId: number } | null> {
  const params = new URLSearchParams({
    from: from.country, from_zip: from.zip_code,
    to:   to.country,   to_zip:   to.zip_code,
  });
  parcels.forEach((p, i) => {
    params.append(`packages[${i}][weight]`, p.weight.toString());
    params.append(`packages[${i}][width]`,  p.width.toString());
    params.append(`packages[${i}][height]`, p.height.toString());
    params.append(`packages[${i}][length]`, p.length.toString());
  });

  const res = await fetch(`${PACKLINK_API_BASE}/services?${params}`, {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) return null;

  const services: Array<{ id: number; price: { tax_included: number } }> =
    await res.json();
  if (!services?.length) return null;

  const cheapest = services.reduce((min, s) =>
    s.price.tax_included < min.price.tax_included ? s : min,
  );
  return { cost: cheapest.price.tax_included, serviceId: cheapest.id };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function splitIntoParcels(totalG: number, maxPackKg: number): number[] {
  const maxG = maxPackKg * 1000;
  const n = Math.ceil(totalG / maxG);
  if (n <= 1) return [totalG];
  const base = Math.floor(totalG / n);
  const result = Array<number>(n - 1).fill(base);
  result.push(totalG - base * (n - 1));
  return result;
}

/** Trova l'aliquota IVA per paese. Fallback su '{*}', poi 0. */
export function resolveVatRate(country: string, vatRates: VatRate[]): number {
  const exact = vatRates.find(
    (v) => !v.countries.includes('*') && v.countries.includes(country),
  );
  if (exact) return exact.vat_rate;
  return vatRates.find((v) => v.countries.includes('*'))?.vat_rate ?? 0;
}

/**
 * Calcola il surplus imballaggio in base alla modalità configurata.
 *   per_parcel → surcharge_amount × num_pacchi
 *   per_order  → surcharge_amount (fisso, indipendente dai pacchi)
 */
export function calcPackagingSurcharge(
  surcharge: PackagingSurcharge,
  numParcels: number,
): number {
  return parseFloat(
    (surcharge.surcharge_mode === 'per_parcel'
      ? surcharge.surcharge_amount * numParcels
      : surcharge.surcharge_amount
    ).toFixed(2),
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function calculateShipping(
  input: ShippingInput,
  packlinkApiKey: string,
): Promise<ShippingResult> {
  const { cartItems, from, to, packagingSurcharge, vatRates } = input;

  // 1. Peso totale e pacchi
  const totalWeightG = cartItems.reduce(
    (sum, i) => sum + (i.weight_grams ?? WEIGHT_FALLBACK_G) * i.quantity, 0,
  );
  const parcelWeightsG = splitIntoParcels(totalWeightG, packagingSurcharge.max_pack_kg);
  const numParcels = parcelWeightsG.length;

  // 2. Surplus imballaggio (modalità da DB)
  const packagingSurchargeTotal = calcPackagingSurcharge(packagingSurcharge, numParcels);

  // 3. Packlink PRO → prezzo corriere
  let packlinkResult: { cost: number; serviceId: number } | null = null;
  try {
    packlinkResult = await fetchPacklinkCost(
      packlinkApiKey, from, to,
      parcelWeightsG.map((g) => ({
        weight: parseFloat((g / 1000).toFixed(3)),
        width: 30, height: 20, length: 40,
      })),
    );
  } catch {
    return {
      available: false, reason: 'packlink_error',
      message: 'Impossible de calculer les frais de livraison. Veuillez réessayer.',
    };
  }

  if (!packlinkResult) {
    return {
      available: false, reason: 'no_service',
      message: 'Aucun service de livraison disponible pour cette destination.',
    };
  }

  // 4. IVA sul prezzo Packlink (configurabile per paese)
  const vatRate  = resolveVatRate(to.country, vatRates);
  const vatAmount = parseFloat((packlinkResult.cost * vatRate).toFixed(2));

  // 5. Totale finale
  const shippingTotal = parseFloat(
    (packlinkResult.cost + vatAmount + packagingSurchargeTotal).toFixed(2),
  );

  return {
    available: true,
    shippingTotal,
    _internal: {
      totalWeightG,
      numParcels,
      packlinkCost: packlinkResult.cost,
      vatRate,
      vatAmount,
      surchargeMode:           packagingSurcharge.surcharge_mode,
      packagingSurchargeTotal,
    },
  };
}
