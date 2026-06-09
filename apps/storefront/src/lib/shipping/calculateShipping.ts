/**
 * calculateShipping.ts
 *
 * Formula:
 *   num_pacchi    = ceil(peso_totale_g / (max_pack_kg × 1000))
 *   packaging     = surcharge_amount × num_pacchi   (se per_parcel)
 *                 = surcharge_amount                 (se per_order)
 *   vat           = packlink_price × vat_rate        (per paese, da DB)
 *   shippingTotal = packlink_price + vat + packaging
 *
 * Note:
 *  - vat_rate configurabile per paese in DB (shipping_vat_rates)
 *    → da confermare con commercialista ChloeFood prima del go-live
 *  - Il corriere scelto da Packlink non viene mai esposto al cliente
 *  - Nessuna differenziazione per tipo conservazione (dry/fresh/frozen)
 *  - Packlink restituisce prezzi B2B (reverse charge, tax_price = 0)
 *    → il vat_rate in DB riguarda l'IVA applicata al cliente finale
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
        totalWeightG:            number;
        numParcels:              number;
        packlinkCost:            number;
        vatRate:                 number;
        vatAmount:               number;
        surchargeMode:           SurchargeMode;
        packagingSurchargeTotal: number;
      };
    }
  | {
      available: false;
      reason:  'packlink_error' | 'no_service';
      message: string;
    };

// ─── Constants ────────────────────────────────────────────────────────────────

const PACKLINK_API_BASE = 'https://api.packlink.com/v1'; // sandbox: https://apisandbox.packlink.com/v1
const WEIGHT_FALLBACK_G = 400;

// ─── Packlink API ─────────────────────────────────────────────────────────────

interface PacklinkService {
  id: number;
  price: {
    base_price: number; // prezzo netto B2B — IVA cliente finale gestita da vat_rate in DB
  };
}

async function fetchPacklinkCost(
  apiKey: string,
  from: ShippingAddress,
  to: ShippingAddress,
  parcels: Array<{ weight: number; width: number; height: number; length: number }>,
): Promise<{ cost: number; serviceId: number } | null> {

  // Sintassi array Packlink: from[country], from[zip], packages[0][weight], ...
  const params = new URLSearchParams();
  params.set('from[country]', from.country);
  params.set('from[zip]',     from.zip_code);
  params.set('to[country]',   to.country);
  params.set('to[zip]',       to.zip_code);

  parcels.forEach((p, i) => {
    params.set(`packages[${i}][weight]`, p.weight.toString());
    params.set(`packages[${i}][width]`,  p.width.toString());
    params.set(`packages[${i}][height]`, p.height.toString());
    params.set(`packages[${i}][length]`, p.length.toString());
  });

  const res = await fetch(`${PACKLINK_API_BASE}/services?${params}`, {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) return null;

  const services: PacklinkService[] = await res.json();
  if (!services?.length) return null;

  // Seleziona il servizio più economico
  const cheapest = services.reduce((min, s) =>
    s.price.base_price < min.price.base_price ? s : min,
  );

  return { cost: cheapest.price.base_price, serviceId: cheapest.id };
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
 *   per_order  → surcharge_amount fisso
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

  // 1. Peso totale e suddivisione pacchi
  const totalWeightG = cartItems.reduce(
    (sum, i) => sum + (i.weight_grams ?? WEIGHT_FALLBACK_G) * i.quantity, 0,
  );
  const parcelWeightsG = splitIntoParcels(totalWeightG, packagingSurcharge.max_pack_kg);
  const numParcels = parcelWeightsG.length;

  // 2. Surplus imballaggio (invisibile al cliente)
  const packagingSurchargeTotal = calcPackagingSurcharge(packagingSurcharge, numParcels);

  // 3. Chiama Packlink PRO — prezzo corriere in tempo reale
  let packlinkResult: { cost: number; serviceId: number } | null = null;
  try {
    packlinkResult = await fetchPacklinkCost(
      packlinkApiKey, from, to,
      parcelWeightsG.map((g) => ({
        weight: parseFloat((g / 1000).toFixed(3)),
        width:  30, // cm — scatola standard
        height: 20,
        length: 40,
      })),
    );
  } catch {
    return {
      available: false,
      reason: 'packlink_error',
      message: 'Impossible de calculer les frais de livraison. Veuillez réessayer.',
    };
  }

  if (!packlinkResult) {
    return {
      available: false,
      reason: 'no_service',
      message: 'Aucun service de livraison disponible pour cette destination.',
    };
  }

  // 4. IVA sul prezzo Packlink (da confermare con commercialista ChloeFood)
  const vatRate   = resolveVatRate(to.country, vatRates);
  const vatAmount = parseFloat((packlinkResult.cost * vatRate).toFixed(2));

  // 5. Totale finale mostrato al cliente
  const shippingTotal = parseFloat(
    (packlinkResult.cost + vatAmount + packagingSurchargeTotal).toFixed(2),
  );

  return {
    available: true,
    shippingTotal,
    _internal: {
      totalWeightG,
      numParcels,
      packlinkCost:            packlinkResult.cost,
      vatRate,
      vatAmount,
      surchargeMode:           packagingSurcharge.surcharge_mode,
      packagingSurchargeTotal,
    },
  };
}
