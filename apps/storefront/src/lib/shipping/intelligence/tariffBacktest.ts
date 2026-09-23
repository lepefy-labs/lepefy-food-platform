import type { ShippingMultiParcelStrategy, ShippingQuoteObservationRow, ShippingTariffBand } from '@lepefy/types';
import { latestValidPerScenario } from './operationalObservation';

export interface BacktestRow {
  providerCost: number;
  weightKg: number;
  zoneCode: string | null;
  numParcels: number;
}

export type ScenarioBacktestObservation = Pick<ShippingQuoteObservationRow,
  | 'id' | 'request_hash' | 'observed_at' | 'eligible' | 'total_provider_cost' | 'total_weight_g'
  | 'destination_zone_code' | 'destination_country' | 'destination_postal_code' | 'num_parcels'>;

export interface ScenarioSampleStats {
  /** Lignes d'offres provider lues (alternatives comprises). */
  offersRead: number;
  /** Exécutions de devis distinctes (un appel provider = une exécution). */
  executions: number;
  /** Scénarios distincts mesurés = taille réelle de l'échantillon. */
  scenarios: number;
  /** Offres alternatives écartées (non comptées comme échantillons). */
  alternativeOffersExcluded: number;
  /** Exécutions plus anciennes d'un même scénario écartées. */
  olderExecutionsExcluded: number;
  postalCodes: number;
  zones: number;
  countries: number;
  /** Part du CAP le plus représenté (0–1) : concentration géographique. */
  topPostalCodeShare: number;
}

/**
 * Transforme des lignes d'offres (une par service Packlink) en échantillon
 * statistique : UNE observation opérationnelle (service éligible au coût total
 * le plus bas) par exécution, puis UNE exécution — la plus récente valide —
 * par scénario (request_hash). Les offres alternatives d'un même devis ne sont
 * jamais des tirages indépendants.
 */
export function buildScenarioBacktestSample(
  rows: ScenarioBacktestObservation[],
  /** Zone recalculée depuis le CAP (zones tenant) ; à défaut, la zone stockée. */
  resolveZone?: (country: string, postalCode: string) => string | null,
): { rows: BacktestRow[]; stats: ScenarioSampleStats } {
  const perScenario = latestValidPerScenario(rows);
  const executions = new Set(rows.map((r) => `${r.request_hash}@${new Date(r.observed_at).toISOString()}`)).size;
  const postal = new Map<string, number>();
  const zones = new Set<string>();
  const countries = new Set<string>();
  let executionsUsedTotal = 0;

  const backtestRows: BacktestRow[] = perScenario.map(({ chosen, executionsForScenario }) => {
    executionsUsedTotal += executionsForScenario;
    const postalKey = `${chosen.destination_country}|${chosen.destination_postal_code}`;
    postal.set(postalKey, (postal.get(postalKey) ?? 0) + 1);
    const zoneCode = resolveZone
      ? resolveZone(chosen.destination_country, chosen.destination_postal_code)
      : chosen.destination_zone_code;
    if (zoneCode) zones.add(zoneCode);
    countries.add(chosen.destination_country);
    return {
      providerCost: Number(chosen.total_provider_cost),
      weightKg: chosen.total_weight_g / 1000,
      zoneCode,
      numParcels: chosen.num_parcels,
    };
  });

  const scenarios = backtestRows.length;
  const topPostal = Math.max(0, ...Array.from(postal.values()));
  return {
    rows: backtestRows,
    stats: {
      offersRead: rows.length,
      executions,
      scenarios,
      alternativeOffersExcluded: rows.length - executions,
      olderExecutionsExcluded: Math.max(0, executionsUsedTotal - scenarios),
      postalCodes: postal.size,
      zones: zones.size,
      countries: countries.size,
      topPostalCodeShare: scenarios > 0 ? parseFloat((topPostal / scenarios).toFixed(3)) : 0,
    },
  };
}

export type SampleReliability = 'insufficient' | 'limited' | 'indicative';

export const MIN_SCENARIOS_FOR_INDICATIVE = 30;
export const MIN_POSTAL_CODES_FOR_INDICATIVE = 10;
/** Couverture par zone : quelques CAP témoins par zone suffisent (prix identiques dans une zone). */
export const MIN_ZONES_FOR_INDICATIVE = 3;

/**
 * Fiabilité volontairement prudente d'un échantillon SYNTHÉTIQUE : jamais
 * « élevée » (grille uniforme, pas la fréquence réelle des commandes).
 *  - insufficient : < 30 scénarios distincts ;
 *  - limited      : couverture géographique étroite (< 3 zones ET < 10 CAP,
 *                   ou un CAP > 50 % de l'échantillon) ;
 *  - indicative   : sinon.
 */
export function assessScenarioReliability(stats: Pick<ScenarioSampleStats, 'scenarios' | 'postalCodes' | 'topPostalCodeShare'> & { zones?: number }): SampleReliability {
  if (stats.scenarios < MIN_SCENARIOS_FOR_INDICATIVE) return 'insufficient';
  if (stats.topPostalCodeShare > 0.5) return 'limited';
  if (stats.postalCodes < MIN_POSTAL_CODES_FOR_INDICATIVE && (stats.zones ?? 0) < MIN_ZONES_FOR_INDICATIVE) return 'limited';
  return 'indicative';
}

export interface BacktestMetrics {
  sampleSize: number;
  avgProviderCost: number | null;
  medianProviderCost: number | null;
  p90ProviderCost: number | null;
  p95ProviderCost: number | null;
  avgMargin: number | null;
  negativeMarginPct: number | null;
  maxLoss: number | null;
  aggregateMargin: number | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/**
 * Tarif client pour un poids/zone/nombre de colis donné, selon un brouillon
 * de tarif. Bandes triées par minKg ; maxKg = null → pas de plafond.
 * Ne modifie jamais rien en checkout — appelé uniquement par le laboratoire.
 */
export function applyTariffDraft(
  bands: ShippingTariffBand[],
  zoneSurcharges: Record<string, number>,
  multiParcelStrategy: ShippingMultiParcelStrategy | null,
  input: { weightKg: number; zoneCode: string | null; numParcels: number },
): number | null {
  const sorted = [...bands].sort((a, b) => a.minKg - b.minKg);
  const band = sorted.find((b) => input.weightKg >= b.minKg && (b.maxKg === null || input.weightKg <= b.maxKg));
  if (!band) return null;

  let price = band.price;
  if (input.zoneCode && zoneSurcharges[input.zoneCode]) {
    price += zoneSurcharges[input.zoneCode]!;
  }

  if (input.numParcels > 1 && multiParcelStrategy) {
    if (multiParcelStrategy.type === 'first_parcel_plus_discounted') {
      price += (input.numParcels - 1) * (multiParcelStrategy.discountedParcelRate ?? 0);
    } else if (multiParcelStrategy.type === 'flat_multi_parcel_rate' && multiParcelStrategy.flatMultiParcelRate != null) {
      price = multiParcelStrategy.flatMultiParcelRate;
    }
    // 'weight_bands_whole_order' : le tarif de bande s'applique déjà au poids total, rien à ajouter.
  }

  return parseFloat(price.toFixed(2));
}

export function backtestTariff(
  bands: ShippingTariffBand[],
  zoneSurcharges: Record<string, number>,
  multiParcelStrategy: ShippingMultiParcelStrategy | null,
  rows: BacktestRow[],
): BacktestMetrics {
  const evaluated = rows
    .map((r) => {
      const customerTariff = applyTariffDraft(bands, zoneSurcharges, multiParcelStrategy, r);
      if (customerTariff === null) return null;
      return { providerCost: r.providerCost, margin: customerTariff - r.providerCost };
    })
    .filter((v): v is { providerCost: number; margin: number } => v !== null);

  const sampleSize = evaluated.length;
  if (sampleSize === 0) {
    return {
      sampleSize: 0, avgProviderCost: null, medianProviderCost: null, p90ProviderCost: null,
      p95ProviderCost: null, avgMargin: null, negativeMarginPct: null, maxLoss: null, aggregateMargin: null,
    };
  }

  const costsSorted = evaluated.map((e) => e.providerCost).sort((a, b) => a - b);
  const margins = evaluated.map((e) => e.margin);
  const negativeCount = margins.filter((m) => m < 0).length;

  return {
    sampleSize,
    avgProviderCost: parseFloat((costsSorted.reduce((s, c) => s + c, 0) / sampleSize).toFixed(2)),
    medianProviderCost: parseFloat(percentile(costsSorted, 50).toFixed(2)),
    p90ProviderCost: parseFloat(percentile(costsSorted, 90).toFixed(2)),
    p95ProviderCost: parseFloat(percentile(costsSorted, 95).toFixed(2)),
    avgMargin: parseFloat((margins.reduce((s, m) => s + m, 0) / sampleSize).toFixed(2)),
    negativeMarginPct: parseFloat(((negativeCount / sampleSize) * 100).toFixed(1)),
    maxLoss: parseFloat(Math.min(...margins).toFixed(2)),
    aggregateMargin: parseFloat(margins.reduce((s, m) => s + m, 0).toFixed(2)),
  };
}
