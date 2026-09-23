/**
 * Tariffazione commerciale (V1G): prezzo autorevole, disponibilità logistica e
 * snapshot persistito sull'ordine.
 *
 * Usato da `/api/shipping/quote` (quotazione) e da `checkoutShipping.ts`
 * (ricalcolo in ogni percorso di pagamento). Nessun dato di prezzo, peso o
 * versione proviene dal browser: prodotti e pesi sono riletti dal DB del
 * tenant, la versione è quella `active` del paese.
 *
 * Separazione formale:
 *   prezzo applicabile (versione attiva + motore puro + regole paese)
 *   ≠ zona servita (zone non consegnabili, territori extra-doganali)
 *   ≠ disponibilità logistica (osservazione identica recente, chiamata
 *     provider limitata nel tempo, evidenza recente dello stesso CAP)
 *   ≠ limiti di peso (oltre il limite logistico verificato serve una risposta
 *     provider positiva, mai la sola formula).
 */

import type { createServiceClient } from '@/lib/supabase/server';
import type {
  ShippingPackagingProfileRow,
  ShippingTariffVersionRow,
  ShippingZoneRow,
} from '@lepefy/types';
import { resolveCountryRule, type ShippingCountryRule } from '@/lib/shipping/resolveCountryRule';
import {
  describePacklinkService, getExclusionReason, isEligibleService, resolveVatRate,
  type PacklinkService, type VatRate,
} from '@/lib/shipping/calculateShipping';
import { extraCustomsTerritory, extraCustomsUnavailableMessage } from '@/lib/shipping/extraCustomsTerritories';
import { cartonsForWeight, splitParcelWeightsFilled } from '@/lib/shipping/cartonSuggestion';
import { resolveZoneCodeFromRows } from '@/lib/shipping/intelligence/resolveZone';
import { requestPacklinkServices } from '@/lib/shipping/intelligence/packlinkQuote';
import { computeRequestHash } from '@/lib/shipping/intelligence/requestHash';
import {
  INTELLIGENCE_FROM_ADDRESS, INTELLIGENCE_PROVIDER, normalizePostalCode, type ScenarioRequest,
} from '@/lib/shipping/intelligence/requestIdentity';
import { findReusableObservation } from '@/lib/shipping/intelligence/equivalence';
import { chooseOperationalOffer, operationalCost } from '@/lib/shipping/intelligence/operationalObservation';
import {
  applyCommercialRulesCents, priceFromTariff,
  type CommercialRulesResult, type TariffPriceResult, type TariffSnapshot,
} from './priceFromTariff';
import { parseTariffVersion } from './tariffVersion';

type ServiceClient = ReturnType<typeof createServiceClient>;
type PricedResult = Extract<TariffPriceResult, { available: true }>;

export const AVAILABILITY_TIMEOUT_MS = 6000;
/** Riuso di un preventivo identico (stesso CAP, stessi colli). */
export const OBSERVATION_FRESHNESS_DAYS = 7;
/** Evidenza di destinazione servita usata solo se il provider non risponde. */
export const EVIDENCE_WINDOW_DAYS = 30;

export type TariffUnavailableCode =
  | 'extra_customs'
  | 'invalid_tariff_config'
  | 'product_unavailable'
  | 'zone_unresolved'
  | 'zone_not_deliverable'
  | 'band_not_covered'
  | 'vat_rate_missing'
  | 'invalid_weight'
  | 'country_mismatch'
  | 'no_service'
  | 'no_eligible_service'
  | 'provider_rejected'
  | 'provider_unavailable';

export type TariffFallbackReason = 'no_active_tariff' | 'missing_product_weight';

export interface TariffPriced {
  kind: 'priced';
  version: ShippingTariffVersionRow;
  tariff: TariffSnapshot;
  destination: { country: string; postalCode: string };
  weightG: number;
  zoneCode: string;
  price: PricedResult;
  commercial: CommercialRulesResult;
  /** Regola paese applicata (per la UI «Livraison offerte»). */
  rule: ShippingCountryRule | null;
  finalCents: number;
}

export type TariffQuoteOutcome =
  | TariffPriced
  | { kind: 'fallback'; reason: TariffFallbackReason; missingProductIds: string[] }
  | { kind: 'unavailable'; reason: TariffUnavailableCode; message: string };

function alternative(clickCollectEnabled: boolean): string {
  return clickCollectEnabled ? 'Choisissez le retrait en magasin ou contactez-nous.' : 'Contactez-nous pour trouver une solution.';
}

export function tariffUnavailableMessage(code: TariffUnavailableCode, clickCollectEnabled: boolean): string {
  const alt = alternative(clickCollectEnabled);
  switch (code) {
    case 'zone_not_deliverable': return `Livraison indisponible vers cette destination. ${alt}`;
    case 'zone_unresolved': return `Ce code postal n'est pas encore desservi en ligne. ${alt}`;
    case 'band_not_covered': return `Cette commande dépasse le poids livrable en ligne. ${alt}`;
    case 'product_unavailable': return 'Certains articles de votre panier ne sont plus disponibles. Veuillez actualiser votre panier.';
    case 'no_service':
    case 'no_eligible_service':
    case 'provider_rejected': return `Aucun service de livraison disponible pour cette destination. ${alt}`;
    case 'provider_unavailable': return `Impossible de confirmer la livraison vers cette destination pour le moment. Réessayez dans quelques minutes. ${alt}`;
    default: return `Livraison momentanément indisponible. ${alt}`;
  }
}

export const MISSING_WEIGHT_MESSAGE = (clickCollectEnabled: boolean) =>
  `Les frais de livraison de certains articles ne peuvent pas encore être calculés. ${alternative(clickCollectEnabled)}`;
export const NO_TARIFF_MESSAGE = (clickCollectEnabled: boolean) =>
  `La livraison en ligne n'est pas disponible vers ce pays. ${alternative(clickCollectEnabled)}`;

/**
 * Normalizza le righe carrello ricevute (quote o sessione) in quantità per
 * prodotto. Rifiuta quantità non intere o fuori limiti.
 */
export function quantitiesFromItems(items: ReadonlyArray<{ productId?: string | null; product_id?: string | null; quantity: unknown }>):
  Map<string, number> | null {
  const out = new Map<string, number>();
  for (const item of items) {
    const id = item.productId ?? item.product_id;
    const qty = item.quantity;
    if (typeof id !== 'string' || !id || !Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > 999) return null;
    out.set(id, (out.get(id) ?? 0) + (qty as number));
  }
  return out.size > 0 ? out : null;
}

export interface TariffQuoteInput {
  supabase: ServiceClient;
  tenantId: string;
  destination: { country: string; postalCode: string };
  quantityByProduct: ReadonlyMap<string, number>;
  /** Subtotale articoli server-side, centesimi (soglia di gratuità). */
  subtotalCents: number;
  clickCollectEnabled: boolean;
}

export async function computeTariffQuote(input: TariffQuoteInput): Promise<TariffQuoteOutcome> {
  const { supabase, tenantId } = input;
  const country = input.destination.country.trim().toUpperCase();
  const postalCode = normalizePostalCode(input.destination.postalCode);
  const unavailable = (reason: TariffUnavailableCode, message?: string): TariffQuoteOutcome =>
    ({ kind: 'unavailable', reason, message: message ?? tariffUnavailableMessage(reason, input.clickCollectEnabled) });

  // 1. Territori extra-doganali: mai consegnabili, qualunque tariffa o override.
  const territory = extraCustomsTerritory(country, postalCode);
  if (territory) return unavailable('extra_customs', extraCustomsUnavailableMessage(territory, input.clickCollectEnabled));

  const productIds = [...input.quantityByProduct.keys()];
  const [versionResult, productsResult, zonesResult, rulesResult, vatResult] = await Promise.all([
    supabase.from('shipping_tariff_versions').select('*')
      .eq('tenant_id', tenantId).eq('country', country).eq('status', 'active').maybeSingle(),
    supabase.from('products').select('id, weight_grams')
      .eq('tenant_id', tenantId).eq('active', true).in('id', productIds),
    supabase.from('shipping_zones').select('*').eq('tenant_id', tenantId).eq('country', country).eq('active', true),
    supabase.from('shipping_country_rules')
      .select('countries, free_shipping_above, flat_rate_override, discount_type, discount_value')
      .eq('tenant_id', tenantId).eq('active', true),
    supabase.from('shipping_vat_rates').select('countries, vat_rate').eq('tenant_id', tenantId).eq('active', true),
  ]);
  if (versionResult.error || productsResult.error || zonesResult.error || rulesResult.error || vatResult.error) {
    throw new Error('tariff_quote_lookup_failed');
  }

  // 2. Versione commerciale attiva del paese.
  const row = versionResult.data as ShippingTariffVersionRow | null;
  if (!row) return { kind: 'fallback', reason: 'no_active_tariff', missingProductIds: [] };
  const parsed = parseTariffVersion(row);
  if (!parsed.ok) {
    console.error('[tariff-quote] version active incohérente — tenant:', tenantId, '— version:', row.id, parsed.errors.join(','));
    return unavailable('invalid_tariff_config');
  }

  // 3. Prodotti e peso netto autorevole (mai il peso dichiarato dal browser, mai un fallback).
  const weightById = new Map(((productsResult.data ?? []) as Array<{ id: string; weight_grams: number | null }>)
    .map((p) => [p.id, p.weight_grams]));
  if (productIds.some((id) => !weightById.has(id))) return unavailable('product_unavailable');
  const missing: string[] = [];
  let weightG = 0;
  for (const [id, qty] of input.quantityByProduct) {
    const w = weightById.get(id);
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) missing.push(id);
    else weightG += Math.round(w) * qty;
  }
  if (missing.length > 0) return { kind: 'fallback', reason: 'missing_product_weight', missingProductIds: missing.sort() };

  // 4. Zona tenant (stessa risoluzione del laboratorio). Una zona sconosciuta
  //    non riceve il prezzo «standard» per difetto: potrebbe essere un'isola.
  const zoneCode = resolveZoneCodeFromRows((zonesResult.data ?? []) as ShippingZoneRow[], country, postalCode);
  if (!zoneCode) return unavailable('zone_unresolved');

  // 5. Prezzo teorico + regole commerciali paese.
  const vatRate = resolveVatRate(country, (vatResult.data ?? []) as VatRate[]);
  const price = priceFromTariff(parsed.tariff, { weightG, country, zoneCode, vatRate });
  if (!price.available) return unavailable(price.reason);
  const rule = resolveCountryRule(country, (rulesResult.data ?? []) as ShippingCountryRule[]);
  const commercial = applyCommercialRulesCents(price.totalTtcCents, input.subtotalCents, rule);

  return {
    kind: 'priced',
    version: row,
    tariff: parsed.tariff,
    destination: { country, postalCode },
    weightG,
    zoneCode,
    price,
    commercial,
    rule,
    finalCents: commercial.finalCents,
  };
}

// ─── Piano colli (stesso della preparazione) ───────────────────────────────

export interface PlannedParcel {
  netG: number;
  grossG: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  profileId: string | null;
  profileName: string | null;
}

type ProfileLike = Pick<ShippingPackagingProfileRow,
  'id' | 'name' | 'box_length_cm' | 'box_width_cm' | 'box_height_cm' | 'active' | 'position' | 'is_default'
  | 'suggest_min_weight_g' | 'suggest_max_weight_g' | 'tare_g'>;

/**
 * Colli pieni fino al limite della versione + resto (20 kg → 15 + 5), cartone
 * per collo con la stessa regola della card «Carton à utiliser» del dettaglio
 * ordine (`cartonsForWeight`), altrimenti profilo di default, altrimenti la
 * scatola `packaging_surcharges`. Tara sommata solo al peso lordo.
 */
export function planTariffParcels(
  weightG: number,
  maxParcelG: number,
  profiles: ProfileLike[],
  defaultBox: { length: number; width: number; height: number } | null,
): PlannedParcel[] | null {
  const weights = splitParcelWeightsFilled(weightG, maxParcelG);
  const fallbackProfile = profiles.find((p) => p.active && p.is_default) ?? null;
  const plan: PlannedParcel[] = [];
  for (const netG of weights) {
    const carton = cartonsForWeight(netG, profiles)[0] ?? fallbackProfile;
    if (carton) {
      plan.push({
        netG, grossG: netG + Math.max(0, Math.round(carton.tare_g ?? 0)),
        lengthCm: Number(carton.box_length_cm), widthCm: Number(carton.box_width_cm), heightCm: Number(carton.box_height_cm),
        profileId: carton.id, profileName: carton.name,
      });
    } else if (defaultBox) {
      plan.push({ netG, grossG: netG, lengthCm: defaultBox.length, widthCm: defaultBox.width, heightCm: defaultBox.height, profileId: null, profileName: null });
    } else {
      return null;
    }
  }
  return plan;
}

export function buildAvailabilityRequest(plan: PlannedParcel[], destination: { country: string; postalCode: string }): ScenarioRequest {
  const parcels = plan.map((p) => ({ weight_g: p.grossG, length_cm: p.lengthCm, width_cm: p.widthCm, height_cm: p.heightCm }));
  const destinationCountry = destination.country.trim().toUpperCase();
  const destinationPostalCode = normalizePostalCode(destination.postalCode);
  return {
    provider: INTELLIGENCE_PROVIDER,
    originCountry: INTELLIGENCE_FROM_ADDRESS.country,
    originPostalCode: INTELLIGENCE_FROM_ADDRESS.zip_code,
    destinationCountry,
    destinationPostalCode,
    numParcels: parcels.length,
    totalWeightG: parcels.reduce((s, p) => s + p.weight_g, 0),
    parcels,
    requestHash: computeRequestHash({
      provider: INTELLIGENCE_PROVIDER,
      originCountry: INTELLIGENCE_FROM_ADDRESS.country,
      originPostalCode: INTELLIGENCE_FROM_ADDRESS.zip_code,
      destinationCountry,
      destinationPostalCode,
      numParcels: parcels.length,
      parcels: parcels.map((p) => ({ weightG: p.weight_g, lengthCm: p.length_cm, widthCm: p.width_cm, heightCm: p.height_cm })),
    }),
  };
}

// ─── Disponibilità logistica ───────────────────────────────────────────────

export type AvailabilitySource = 'observation' | 'live' | 'recent_evidence' | 'not_checked';

export type AvailabilityResult =
  | {
      available: true;
      source: AvailabilitySource;
      /** Preventivo provider TTC (base + IVA), senza imballaggio; null se non noto. */
      providerQuoteTtcCents: number | null;
      carrier: string | null;
      service: string | null;
      parcels: PlannedParcel[] | null;
    }
  | { available: false; reason: Extract<TariffUnavailableCode, 'no_service' | 'no_eligible_service' | 'provider_rejected' | 'provider_unavailable'>; parcels: PlannedParcel[] | null };

export interface AvailabilityInput {
  supabase: ServiceClient;
  tenantId: string;
  shippingProvider: string;
  apiKey: string | null;
  priced: TariffPriced;
  vatRate: number;
  profiles: ProfileLike[];
  defaultBox: { length: number; width: number; height: number } | null;
  now?: number;
  timeoutMs?: number;
  /** Iniettabile nei test. */
  fetchServices?: typeof requestPacklinkServices;
}

function providerTtcCents(base: number | null, tax: number | null, vatRate: number): number | null {
  if (base === null || !Number.isFinite(base)) return null;
  const baseCents = Math.round(base * 100);
  const taxCents = tax && tax > 0 ? Math.round(tax * 100) : Math.round(base * vatRate * 100);
  return baseCents + taxCents;
}

export async function checkTariffAvailability(input: AvailabilityInput): Promise<AvailabilityResult> {
  const { supabase, tenantId, priced } = input;
  // Provider senza API di preventivo (es. flat_rate storico): nessun controllo possibile.
  if (input.shippingProvider !== 'packlink') {
    return { available: true, source: 'not_checked', providerQuoteTtcCents: null, carrier: null, service: null, parcels: null };
  }

  const plan = planTariffParcels(priced.weightG, priced.tariff.maxParcelWeightG, input.profiles, input.defaultBox);
  const overVerifiedLimit = priced.tariff.logisticsVerifiedMaxWeightG !== null && priced.weightG > priced.tariff.logisticsVerifiedMaxWeightG;
  if (!plan) return { available: false, reason: 'provider_unavailable', parcels: null };
  const request = buildAvailabilityRequest(plan, priced.destination);
  const now = input.now ?? Date.now();

  // a) Preventivo identico (stesso CAP, stessi colli) ancora fresco.
  const reusable = await findReusableObservation(supabase, { tenantId, request, freshnessWindowDays: OBSERVATION_FRESHNESS_DAYS, now });
  if (reusable) {
    return {
      available: true, source: 'observation',
      providerQuoteTtcCents: providerTtcCents(reusable.base_price, reusable.tax_price, input.vatRate),
      carrier: reusable.carrier, service: reusable.service_name, parcels: plan,
    };
  }

  // b) Chiamata provider limitata nel tempo.
  const fetchServices = input.fetchServices ?? requestPacklinkServices;
  const response = input.apiKey
    ? await fetchServices(input.apiKey, INTELLIGENCE_FROM_ADDRESS,
        { country: request.destinationCountry, zip_code: request.destinationPostalCode },
        request.parcels.map((p) => ({ weight: parseFloat((p.weight_g / 1000).toFixed(3)), width: p.width_cm, height: p.height_cm, length: p.length_cm })),
        { timeoutMs: input.timeoutMs ?? AVAILABILITY_TIMEOUT_MS })
    : { kind: 'error' as const, status: null };

  if (response.kind === 'rejected') return { available: false, reason: 'provider_rejected', parcels: plan };
  if (response.kind === 'ok') {
    const services = response.services;
    if (services.length === 0) return { available: false, reason: 'no_service', parcels: plan };
    await persistRealQuote(supabase, tenantId, request, priced.zoneCode, plan, services);
    const chosen = chooseOperationalOffer(services.map((s) => ({
      id: s.id, eligible: isEligibleService(s), basePrice: Number(s.price.base_price), taxPrice: Number(s.price.tax_price ?? 0),
    })));
    if (!chosen) return { available: false, reason: 'no_eligible_service', parcels: plan };
    const service = services.find((s) => s.id === chosen.id)!;
    const described = describePacklinkService(service);
    return {
      available: true, source: 'live',
      providerQuoteTtcCents: providerTtcCents(Number(service.price.base_price), Number(service.price.tax_price ?? 0), input.vatRate),
      carrier: described.carrierName || null, service: described.serviceName || null, parcels: plan,
    };
  }

  // c) Provider in errore / timeout: mai una dichiarazione positiva implicita.
  //    Accettata solo un'evidenza recente dello stesso CAP, e mai oltre il
  //    limite logistico verificato.
  if (overVerifiedLimit) return { available: false, reason: 'provider_unavailable', parcels: plan };
  const sinceIso = new Date(now - EVIDENCE_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: evidence, error } = await supabase
    .from('shipping_quote_observations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('provider', INTELLIGENCE_PROVIDER)
    .eq('destination_country', request.destinationCountry)
    .eq('destination_postal_code', request.destinationPostalCode)
    .eq('eligible', true)
    .gte('observed_at', sinceIso)
    .limit(1);
  if (!error && (evidence ?? []).length > 0) {
    console.warn('[tariff-quote] provider indisponible — preuve récente du CAP utilisée — tenant:', tenantId);
    return { available: true, source: 'recent_evidence', providerQuoteTtcCents: null, carrier: null, service: null, parcels: plan };
  }
  return { available: false, reason: 'provider_unavailable', parcels: plan };
}

async function persistRealQuote(
  supabase: ServiceClient,
  tenantId: string,
  request: ScenarioRequest,
  zoneCode: string,
  plan: PlannedParcel[],
  services: PacklinkService[],
): Promise<void> {
  const profileIds = [...new Set(plan.map((p) => p.profileId))];
  const rows = services.map((s) => {
    const { carrierName, serviceName } = describePacklinkService(s);
    return {
      tenant_id: tenantId,
      provider: request.provider,
      source: 'real_quote',
      campaign_id: null,
      origin_country: request.originCountry,
      origin_postal_code: request.originPostalCode,
      destination_country: request.destinationCountry,
      destination_postal_code: request.destinationPostalCode,
      destination_zone_code: zoneCode,
      num_parcels: request.numParcels,
      parcels: request.parcels,
      total_weight_g: request.totalWeightG,
      packaging_profile_id: profileIds.length === 1 ? profileIds[0] : null,
      service_id: String(s.id),
      carrier: carrierName || null,
      service_name: serviceName || null,
      base_price: s.price.base_price,
      tax_price: s.price.tax_price ?? 0,
      total_provider_cost: operationalCost({ base_price: s.price.base_price, tax_price: s.price.tax_price ?? 0 }),
      eligible: isEligibleService(s),
      exclusion_reason: getExclusionReason(s),
      request_hash: request.requestHash,
    };
  });
  try {
    const { error } = await supabase.from('shipping_quote_observations').insert(rows);
    if (error) console.warn('[tariff-quote] persistance du devis réel échouée — tenant:', tenantId);
  } catch {
    console.warn('[tariff-quote] persistance du devis réel échouée — tenant:', tenantId);
  }
}

// ─── Snapshot persistito ───────────────────────────────────────────────────

export interface TariffAvailabilitySnapshot {
  source: string | null;
  providerQuoteTtcCents: number | null;
  carrier: string | null;
  service: string | null;
}

/**
 * `shipping_details` di un ordine al forfait: tutto ciò che serve a spiegare
 * l'importo pagato anche dopo il ritiro della versione. I campi letti da
 * picking/carton (`totalWeightG`, `numParcels`, `carrierName`) restano al
 * primo livello; `packlinkCost` NON è scritto (il cliente non ha pagato il
 * preventivo provider).
 */
export function buildTariffShippingDetails(priced: TariffPriced, availability: TariffAvailabilitySnapshot, verifiedAt = new Date()): Record<string, unknown> {
  const p = priced.price;
  return {
    pricingMode: 'tariff',
    totalWeightG: priced.weightG,
    numParcels: p.numParcels,
    carrierName: availability.carrier ?? '',
    serviceName: availability.service ?? '',
    tariff: {
      schema: 1,
      versionId: priced.version.id,
      version: priced.version.version,
      name: priced.version.name,
      country: priced.destination.country,
      currency: priced.version.currency,
      pricesIncludeVat: priced.version.prices_include_vat,
      postalCode: priced.destination.postalCode,
      zoneCode: priced.zoneCode,
      weightG: priced.weightG,
      blocks: p.blocks,
      blockWeightG: p.blockWeightG,
      blockPriceCents: p.blockPriceCents,
      remainderWeightG: p.remainderWeightG,
      band: p.band,
      parcelsG: p.parcelsG,
      zoneSurcharge: p.zoneSurcharge,
      vat: { rate: p.vat.rate, amountCents: p.vat.amountCents, includedInTariff: p.vat.includedInTariff },
      theoreticalCents: p.totalTtcCents,
      commercial: priced.commercial,
      finalCents: priced.finalCents,
      availability: { source: availability.source },
      providerQuoteTtcCents: availability.providerQuoteTtcCents,
      warnings: p.warnings,
      verifiedAt: verifiedAt.toISOString(),
    },
  };
}

/** Lettura robusta dello snapshot di una sessione/ordine. */
export function readTariffSnapshot(details: Record<string, unknown> | null | undefined):
  { versionId: string; version: number; finalCents: number; weightG: number; postalCode: string; country: string } | null {
  if (!details || details.pricingMode !== 'tariff') return null;
  const t = details.tariff as Record<string, unknown> | undefined;
  if (!t || typeof t.versionId !== 'string' || !Number.isInteger(t.version) || !Number.isInteger(t.finalCents)
    || !Number.isInteger(t.weightG) || typeof t.postalCode !== 'string' || typeof t.country !== 'string') return null;
  return { versionId: t.versionId, version: t.version as number, finalCents: t.finalCents as number, weightG: t.weightG as number, postalCode: t.postalCode, country: t.country };
}

