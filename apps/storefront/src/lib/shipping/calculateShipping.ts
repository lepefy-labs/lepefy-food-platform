/**
 * calculateShipping.ts
 *
 * Formula:
 *   num_pacchi    = ceil(peso_totale_g / (max_pack_kg × 1000))
 *   packaging     = surcharge_amount × num_pacchi   (se per_parcel)
 *                 = surcharge_amount                 (se per_order)
 *   vat           = tax_price (Packlink) se > 0, altrimenti packlink_price × vat_rate (DB)
 *   shippingTotal = packlink_price + vat + packaging
 * max_pack_kg = limite fisico dichiarato dalla cliente (carico manuale nel furgone)
 *               NON è un limite Packlink — Packlink accetta pesi arbitrari.
 *   Determina: 1) quanti pacchi fisici prepara ChloeFood
 *              2) il numero di surcharge imballaggio (3€ × n_pacchi)
 *              3) i pacchi passati all'API Packlink per il calcolo tariffe
 * Filtri applicati sui servizi Packlink:
 *   - dropoff: false        → solo consegna a domicilio (no locker, no punto ritiro)
 *   - no company-collection → esclude servizi B2B non applicabili a privati
 *
 * Dimensioni pacco configurabili in DB (packaging_surcharges):
 *   box_length_cm, box_width_cm, box_height_cm
 *   → usate per il calcolo peso volumetrico da parte di Packlink
 *   → peso_vol = (L × W × H) / 5000
 *
 * Tutto configurabile in DB — zero modifiche al codice per cambiare importi o logica.
 */

import { grossParcelWeights, type PackagingWeightBand } from './packagingWeight';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SurchargeMode = 'per_parcel' | 'per_order';
export type VatSource = 'packlink' | 'db';

export interface PackagingSurcharge {
  surcharge_amount: number;
  surcharge_mode:   SurchargeMode;
  max_pack_kg:      number;
  box_length_cm:    number;
  box_width_cm:     number;
  box_height_cm:    number;
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
  /** Tranches de poids d'emballage du tenant (migration 180). Absent/vide = poids net historique. */
  packagingWeightBands?: PackagingWeightBand[];
  /**
   * Preventivi internazionali: nessun peso convenzionale (400 g), IVA solo da
   * risposta esplicita del provider o da una riga `shipping_vat_rates` del paese
   * (o `*`), timeout provider. Assente = comportamento storico invariato.
   */
  strict?: { timeoutMs?: number };
}

export type ShippingResult =
  | {
      available: true;
      shippingTotal: number;
      _internal: {
        /** Toujours le poids NET : relu par la bozza, le carton suggéré et les PDF. */
        totalWeightG:            number;
        /** Présents seulement si le tenant a des tranches d'emballage. */
        packagingWeightG?:       number;
        grossWeightG?:           number;
        numParcels:              number;
        packlinkCost:            number;
        vatRate:                 number;
        vatAmount:               number;
        vatSource:               VatSource;
        surchargeMode:           SurchargeMode;
        packagingSurchargeTotal: number;
        boxDimensions:           { length: number; width: number; height: number };
        serviceId:               number;
        serviceName:             string;
        carrierName:             string;
      };
    }
  | {
      available: false;
      reason:  'packlink_error' | 'no_service' | 'timeout' | 'missing_weight' | 'vat_unknown';
      message: string;
    };

/** Esito del tentativo di lettura servizi: distingue errore API e timeout da «nessun servizio». */
export interface PacklinkFetchFailure { kind?: 'api_error' | 'timeout' }

// ─── Constants ────────────────────────────────────────────────────────────────

export const PACKLINK_API_BASE = 'https://api.packlink.com/v1'; // sandbox: https://apisandbox.packlink.com/v1
const WEIGHT_FALLBACK_G = 400;

// ─── Packlink API ─────────────────────────────────────────────────────────────

export interface PacklinkServiceInfo {
  text: string;
  icon: string;
}

export interface PacklinkService {
  id:           number;
  name:         string;
  carrier_name: string;
  dropoff:      boolean;
  service_info: PacklinkServiceInfo[];
  price: {
    base_price: number;
    tax_price:  number;
  };
}

export type PacklinkExclusionReason = 'dropoff' | 'b2b';

// null = servizio eligibile. Usata sia da isEligibleService() (flusso reale)
// sia dal simulatore admin, che deve mostrare il motivo esatto dello scarto
// per i servizi non scelti.
export function getExclusionReason(s: PacklinkService): PacklinkExclusionReason | null {
  if (s.dropoff) return 'dropoff';
  const isB2B = s.service_info.some(
    (info) => info.icon === 'b2b' || info.text.includes('company-collection'),
  );
  if (isB2B) return 'b2b';
  return null;
}

export function isEligibleService(s: PacklinkService): boolean {
  return getExclusionReason(s) === null;
}

// Vista leggibile di un PacklinkService — riusata dal simulatore admin per
// mostrare corriere/servizio senza duplicare l'accesso ai campi grezzi.
export function describePacklinkService(s: PacklinkService): {
  carrierName: string;
  serviceName: string;
  infoLabels:  string[];
} {
  return {
    carrierName: s.carrier_name ?? '',
    serviceName: s.name ?? '',
    infoLabels:  (s.service_info ?? []).map((info) => info.text),
  };
}

// Chiamata grezza a Packlink PRO: ritorna TUTTI i servizi per la destinazione
// (eligibili o no), senza applicare alcun filtro. null in caso di errore rete
// /API/parsing — non lancia mai, il chiamante decide come gestire l'assenza
// di risultato (flusso reale vs simulatore admin hanno esigenze diverse).
export async function fetchAllPacklinkServices(
  apiKey: string,
  from: ShippingAddress,
  to: ShippingAddress,
  parcels: Array<{ weight: number; width: number; height: number; length: number }>,
  opts?: { timeoutMs?: number; failure?: PacklinkFetchFailure },
): Promise<PacklinkService[] | null> {

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

  const url = `${PACKLINK_API_BASE}/services?${params}`;
  console.info('[calculateShipping] Packlink request — url:', url.replace(apiKey, '***'));

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: apiKey },
      ...(opts?.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
  } catch (err) {
    if (!opts?.timeoutMs) throw err;
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (opts.failure) opts.failure.kind = timedOut ? 'timeout' : 'api_error';
    console.error('[calculateShipping] Packlink request failed — timeout:', timedOut);
    return null;
  }

  if (!res.ok) {
    if (opts?.failure) opts.failure.kind = 'api_error';
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    console.error('[calculateShipping] Packlink API error — status:', res.status, '— body:', body.slice(0, 500));
    return null;
  }

  try {
    const services = await res.json() as PacklinkService[];
    console.info('[calculateShipping] Packlink services returned:', services?.length ?? 0, 'total');
    return services ?? [];
  } catch (parseErr) {
    console.error('[calculateShipping] Packlink response JSON parse error:', parseErr);
    if (opts?.failure) opts.failure.kind = 'api_error';
    return null;
  }
}

async function fetchPacklinkCost(
  apiKey: string,
  from: ShippingAddress,
  to: ShippingAddress,
  parcels: Array<{ weight: number; width: number; height: number; length: number }>,
  opts?: { timeoutMs?: number; failure?: PacklinkFetchFailure },
): Promise<{ cost: number; taxPrice: number; serviceId: number; serviceName: string; carrierName: string } | null> {

  const services = await fetchAllPacklinkServices(apiKey, from, to, parcels, opts);

  if (!services?.length) {
    console.info('[calculateShipping] Packlink returned 0 services for this destination');
    return null;
  }

  const eligible = services.filter(isEligibleService);
  console.info('[calculateShipping] eligible services (home delivery, no B2B):', eligible.length);

  if (!eligible.length) {
    console.info('[calculateShipping] no eligible services — all filtered out');
    return null;
  }

  const cheapest = eligible.reduce((min, s) =>
    s.price.base_price < min.price.base_price ? s : min,
  );

  console.info('[calculateShipping] cheapest service — id:', cheapest.id, '— name:', cheapest.name, '— base_price:', cheapest.price.base_price, '— tax_price:', cheapest.price.tax_price);

  return {
    cost:        cheapest.price.base_price,
    taxPrice:    cheapest.price.tax_price ?? 0,
    serviceId:   cheapest.id,
    serviceName: cheapest.name ?? '',
    carrierName: cheapest.carrier_name ?? '',
  };
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

export function resolveVatRate(country: string, vatRates: VatRate[]): number {
  const exact = vatRates.find(
    (v) => !v.countries.includes('*') && v.countries.includes(country),
  );
  if (exact) return exact.vat_rate;
  return vatRates.find((v) => v.countries.includes('*'))?.vat_rate ?? 0;
}

/** Une riga IVA esiste per il paese o per «*»: nessuna aliquota dedotta dal solo paese. */
export function hasExplicitVatRate(country: string, vatRates: VatRate[]): boolean {
  return vatRates.some((v) => v.countries.includes(country) || v.countries.includes('*'));
}

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

  // 0. Modalità rigorosa: un peso mancante rende il preventivo inattendibile.
  if (input.strict && cartItems.some((i) => typeof i.weight_grams !== 'number' || !Number.isFinite(i.weight_grams) || i.weight_grams <= 0)) {
    return {
      available: false,
      reason: 'missing_weight',
      message: 'Impossible de calculer les frais de livraison pour certains articles.',
    };
  }

  // 1. Peso totale e suddivisione pacchi
  const totalWeightG = cartItems.reduce(
    (sum, i) => sum + (i.weight_grams ?? WEIGHT_FALLBACK_G) * i.quantity, 0,
  );
  const parcelWeightsG = splitIntoParcels(totalWeightG, packagingSurcharge.max_pack_kg);
  const numParcels = parcelWeightsG.length;
  // Le découpage et le supplément restent sur le net ; seul le poids envoyé à Packlink change.
  const packagingWeightBands = input.packagingWeightBands ?? [];
  const grossWeightsG = grossParcelWeights(parcelWeightsG, packagingWeightBands);
  const grossWeightG = grossWeightsG.reduce((sum, g) => sum + g, 0);

  console.info('[calculateShipping] totalWeightG:', totalWeightG, '— grossWeightG:', grossWeightG, '— numParcels:', numParcels, '— to:', to.country, to.zip_code);

  // 2. Surplus imballaggio
  const packagingSurchargeTotal = calcPackagingSurcharge(packagingSurcharge, numParcels);

  // 3. Dimensioni pacco da DB
  const boxDimensions = {
    length: packagingSurcharge.box_length_cm,
    width:  packagingSurcharge.box_width_cm,
    height: packagingSurcharge.box_height_cm,
  };

  // 4. Chiama Packlink PRO
  let packlinkResult: { cost: number; taxPrice: number; serviceId: number; serviceName: string; carrierName: string } | null = null;
  const failure: PacklinkFetchFailure = {};
  try {
    packlinkResult = await fetchPacklinkCost(
      packlinkApiKey, from, to,
      grossWeightsG.map((g) => ({
        weight: parseFloat((g / 1000).toFixed(3)),
        width:  boxDimensions.width,
        height: boxDimensions.height,
        length: boxDimensions.length,
      })),
      input.strict ? { timeoutMs: input.strict.timeoutMs ?? 8000, failure } : undefined,
    );
  } catch (err) {
    console.error('[calculateShipping] fetchPacklinkCost threw unexpectedly:', err);
    return {
      available: false,
      reason: 'packlink_error',
      message: 'Impossible de calculer les frais de livraison. Veuillez réessayer.',
    };
  }

  if (!packlinkResult && failure.kind) {
    return {
      available: false,
      reason: failure.kind === 'timeout' ? 'timeout' : 'packlink_error',
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

  // 5. IVA: usa tax_price Packlink se > 0, altrimenti tasso DB per paese
  let vatAmount: number;
  let vatRate: number;
  let vatSource: VatSource;

  if (packlinkResult.taxPrice > 0) {
    vatAmount = parseFloat(packlinkResult.taxPrice.toFixed(2));
    vatRate   = parseFloat((vatAmount / packlinkResult.cost).toFixed(4));
    vatSource = 'packlink';
  } else {
    if (input.strict && !hasExplicitVatRate(to.country, vatRates)) {
      return {
        available: false,
        reason: 'vat_unknown',
        message: 'Impossible de confirmer le tarif de livraison pour cette destination.',
      };
    }
    vatRate   = resolveVatRate(to.country, vatRates);
    vatAmount = parseFloat((packlinkResult.cost * vatRate).toFixed(2));
    vatSource = 'db';
  }

  // 6. Totale finale mostrato al cliente
  const shippingTotal = parseFloat(
    (packlinkResult.cost + vatAmount + packagingSurchargeTotal).toFixed(2),
  );

  console.info('[calculateShipping] result — shippingTotal:', shippingTotal, '— packlinkCost:', packlinkResult.cost, '— vat:', vatAmount, '(source:', vatSource + ')', '— surcharge:', packagingSurchargeTotal);

  return {
    available: true,
    shippingTotal,
    _internal: {
      totalWeightG,
      ...(packagingWeightBands.length > 0 ? { packagingWeightG: grossWeightG - totalWeightG, grossWeightG } : {}),
      numParcels,
      packlinkCost:            packlinkResult.cost,
      vatRate,
      vatAmount,
      vatSource,
      surchargeMode:           packagingSurcharge.surcharge_mode,
      packagingSurchargeTotal,
      boxDimensions,
      serviceId:               packlinkResult.serviceId,
      serviceName:             packlinkResult.serviceName,
      carrierName:             packlinkResult.carrierName,
    },
  };
}
