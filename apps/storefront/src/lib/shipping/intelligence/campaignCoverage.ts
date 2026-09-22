import type {
  ShippingCampaignItemScenario,
  ShippingPackagingProfileRow,
  ShippingQuoteObservationRow,
  ShippingScenarioDestination,
  ShippingSimulationCampaignItemRow,
} from '@lepefy/types';
import { buildScenarioRequest, compareObservationToRequest, normalizePostalCode, type IdentityMismatch } from './requestIdentity';

/**
 * Classement vérifiable d'un item de campagne. Seuls `quoted` et
 * `reused_valid` couvrent un scénario :
 *  - quoted                   : nouvel appel Packlink, observation choisie cohérente ;
 *  - reused_valid             : réemploi d'un devis STRICTEMENT identique et frais ;
 *  - reused_other_postal_code : réemploi historique d'un devis d'un AUTRE CAP ;
 *  - reused_incompatible      : réemploi historique divergent (poids, colis,
 *                               dimensions, origine) ou hors fenêtre de fraîcheur ;
 *  - observation_missing      : aucune observation rattachée/retrouvée ;
 *  - unverifiable             : impossible de prouver la cohérence (profil
 *                               supprimé, observation non éligible, divergence
 *                               sur un scénario pourtant « quoted »).
 */
export type ItemCoverageClass =
  | 'quoted'
  | 'reused_valid'
  | 'pending'
  | 'running'
  | 'failed'
  | 'reused_other_postal_code'
  | 'reused_incompatible'
  | 'observation_missing'
  | 'unverifiable';

export const VALID_COVERAGE_CLASSES: ReadonlySet<ItemCoverageClass> = new Set(['quoted', 'reused_valid']);
export const INCOMPATIBLE_HISTORY_CLASSES: ReadonlySet<ItemCoverageClass> = new Set([
  'reused_other_postal_code', 'reused_incompatible', 'observation_missing', 'unverifiable',
]);

export interface ItemClassification {
  cls: ItemCoverageClass;
  mismatch?: IdentityMismatch | 'stale' | 'not_eligible' | 'profile_missing' | 'campaign';
}

type ProfileShape = Pick<ShippingPackagingProfileRow, 'id' | 'box_length_cm' | 'box_width_cm' | 'box_height_cm' | 'max_weight_g'>;

export function classifyCampaignItem(
  item: Pick<ShippingSimulationCampaignItemRow, 'status' | 'observation_id' | 'scenario' | 'attempted_at' | 'campaign_id'>,
  observation: ShippingQuoteObservationRow | undefined,
  profile: ProfileShape | undefined,
  tenantId: string,
  freshnessWindowDays: number,
): ItemClassification {
  if (item.status === 'pending') return { cls: 'pending' };
  if (item.status === 'running') return { cls: 'running' };
  if (item.status === 'failed') return { cls: 'failed' };

  const reused = item.status === 'skipped_duplicate';
  if (!item.observation_id || !observation) return { cls: 'observation_missing' };
  if (observation.tenant_id !== tenantId) return { cls: reused ? 'reused_incompatible' : 'unverifiable', mismatch: 'tenant' };
  if (!observation.eligible || observation.total_provider_cost == null) {
    return { cls: reused ? 'reused_incompatible' : 'unverifiable', mismatch: 'not_eligible' };
  }

  const scenario = item.scenario;
  const expectedCountry = scenario.destination.country.trim().toUpperCase();
  const expectedPostal = normalizePostalCode(scenario.destination.postalCode);
  if (observation.destination_country.trim().toUpperCase() !== expectedCountry) {
    return { cls: reused ? 'reused_other_postal_code' : 'unverifiable', mismatch: 'destination_country' };
  }
  if (normalizePostalCode(observation.destination_postal_code) !== expectedPostal) {
    return { cls: reused ? 'reused_other_postal_code' : 'unverifiable', mismatch: 'destination_postal_code' };
  }
  if (Number(observation.total_weight_g) !== Math.round(scenario.weightKg * 1000)) {
    return { cls: reused ? 'reused_incompatible' : 'unverifiable', mismatch: 'total_weight' };
  }

  if (!reused) {
    // Nouvel appel : l'observation reflète la demande réellement envoyée à
    // l'époque (le profil a pu être modifié depuis) — on exige qu'elle
    // appartienne à cette campagne et à ce profil.
    if (observation.campaign_id !== item.campaign_id) return { cls: 'unverifiable', mismatch: 'campaign' };
    if (observation.packaging_profile_id !== scenario.packagingProfileId) return { cls: 'unverifiable', mismatch: 'parcels' };
    return { cls: 'quoted' };
  }

  // Réemploi : l'observation d'origine doit être strictement identique à la
  // demande que ce scénario aurait envoyée, et fraîche au moment du réemploi.
  if (!profile) return { cls: 'unverifiable', mismatch: 'profile_missing' };
  const request = buildScenarioRequest({ weightKg: scenario.weightKg, profile, destination: scenario.destination });
  const mismatch = compareObservationToRequest(observation, request, tenantId);
  if (mismatch) {
    return { cls: mismatch === 'destination_postal_code' ? 'reused_other_postal_code' : 'reused_incompatible', mismatch };
  }
  if (item.attempted_at) {
    const ageMs = Date.parse(item.attempted_at) - Date.parse(observation.observed_at);
    if (ageMs > freshnessWindowDays * 24 * 60 * 60 * 1000) return { cls: 'reused_incompatible', mismatch: 'stale' };
  }
  return { cls: 'reused_valid' };
}

export type CoverageStatus = 'complete' | 'partial' | 'todo' | 'incompatible';

export interface CoverageRow {
  key: string;
  country: string;
  postalCode: string;
  city: string | null;
  zoneCode: string | null;
  profileId: string;
  profileName: string;
  planned: number;
  quoted: number;
  reusedValid: number;
  pending: number;
  running: number;
  failed: number;
  incompatible: number;
  plannedWeightsKg: number[];
  coveredWeightsKg: number[];
  missingWeightsKg: number[];
  lastValidQuoteAt: string | null;
  minCost: number | null;
  maxCost: number | null;
  status: CoverageStatus;
}

export interface PostalCoverage {
  country: string;
  postalCode: string;
  city: string | null;
  zoneCode: string | null;
  planned: number;
  valid: number;
  coveredProfiles: number;
  profiles: number;
  status: CoverageStatus;
}

export interface CoverageSummary {
  plannedPostalCodes: number;
  completePostalCodes: number;
  plannedScenarios: number;
  newQuotes: number;
  validReuses: number;
  failed: number;
  remaining: number;
  pending: number;
  running: number;
  incompatible: number;
  byClass: Record<ItemCoverageClass, number>;
  resampleCandidates: number;
}

export interface CampaignCoverage {
  summary: CoverageSummary;
  rows: CoverageRow[];
  postalCodes: PostalCoverage[];
}

function statusFor(valid: number, planned: number, incompatible: number): CoverageStatus {
  if (planned > 0 && valid === planned) return 'complete';
  if (incompatible > 0) return 'incompatible';
  if (valid > 0) return 'partial';
  return 'todo';
}

function cityFromDestination(destination: ShippingScenarioDestination | undefined): string | null {
  if (!destination) return null;
  if (destination.city) return destination.city;
  // Campagnes antérieures : label « Ville · CAP » construit par le client.
  const label = destination.label ?? '';
  const [first, second] = label.split(' · ');
  if (first && second && normalizePostalCode(second) === normalizePostalCode(destination.postalCode) && !/^[A-Z]{2}$/.test(first)) return first;
  return null;
}

export function needsResample(cls: ItemCoverageClass): boolean {
  return cls === 'failed' || INCOMPATIBLE_HISTORY_CLASSES.has(cls);
}

/**
 * Agrège la couverture d'une campagne par CAP × profil (tableau) et par CAP
 * (synthèse). Un CAP n'est complet que lorsque TOUS ses scénarios ont un devis
 * valide (nouvel appel ou réemploi strictement identique).
 */
export function computeCampaignCoverage(params: {
  tenantId: string;
  items: Array<Pick<ShippingSimulationCampaignItemRow, 'id' | 'status' | 'observation_id' | 'scenario' | 'attempted_at' | 'campaign_id'>>;
  observationsById: Map<string, ShippingQuoteObservationRow>;
  profilesById: Map<string, ProfileShape & { name: string }>;
  destinations: ShippingScenarioDestination[];
  freshnessWindowDays: number;
}): CampaignCoverage & { classifications: Map<string, ItemClassification> } {
  const destinationByKey = new Map(params.destinations.map((d) => [`${d.country}|${normalizePostalCode(d.postalCode)}`, d]));
  const byClass = {
    quoted: 0, reused_valid: 0, pending: 0, running: 0, failed: 0,
    reused_other_postal_code: 0, reused_incompatible: 0, observation_missing: 0, unverifiable: 0,
  } as Record<ItemCoverageClass, number>;
  const classifications = new Map<string, ItemClassification>();
  const rows = new Map<string, CoverageRow & { covered: Set<number>; plannedSet: Set<number> }>();

  for (const item of params.items) {
    const scenario = item.scenario as ShippingCampaignItemScenario;
    const observation = item.observation_id ? params.observationsById.get(item.observation_id) : undefined;
    const profile = params.profilesById.get(scenario.packagingProfileId);
    const classification = classifyCampaignItem(item, observation, profile, params.tenantId, params.freshnessWindowDays);
    classifications.set(item.id, classification);
    byClass[classification.cls]++;

    const country = scenario.destination.country.trim().toUpperCase();
    const postalCode = normalizePostalCode(scenario.destination.postalCode);
    const destination = destinationByKey.get(`${country}|${postalCode}`);
    const key = `${country}|${postalCode}|${scenario.packagingProfileId}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key, country, postalCode,
        city: cityFromDestination(destination),
        zoneCode: scenario.destination.zoneCode ?? destination?.zoneCode ?? null,
        profileId: scenario.packagingProfileId,
        profileName: profile?.name ?? 'Profil supprimé',
        planned: 0, quoted: 0, reusedValid: 0, pending: 0, running: 0, failed: 0, incompatible: 0,
        plannedWeightsKg: [], coveredWeightsKg: [], missingWeightsKg: [],
        lastValidQuoteAt: null, minCost: null, maxCost: null, status: 'todo',
        covered: new Set(), plannedSet: new Set(),
      };
      rows.set(key, row);
    }

    row.planned++;
    row.plannedSet.add(scenario.weightKg);
    switch (classification.cls) {
      case 'quoted': row.quoted++; break;
      case 'reused_valid': row.reusedValid++; break;
      case 'pending': row.pending++; break;
      case 'running': row.running++; break;
      case 'failed': row.failed++; break;
      default: row.incompatible++;
    }
    if (VALID_COVERAGE_CLASSES.has(classification.cls) && observation) {
      row.covered.add(scenario.weightKg);
      const cost = Number(observation.total_provider_cost);
      row.minCost = row.minCost === null ? cost : Math.min(row.minCost, cost);
      row.maxCost = row.maxCost === null ? cost : Math.max(row.maxCost, cost);
      if (!row.lastValidQuoteAt || observation.observed_at > row.lastValidQuoteAt) row.lastValidQuoteAt = observation.observed_at;
    }
  }

  const finalRows: CoverageRow[] = Array.from(rows.values()).map(({ covered, plannedSet, ...row }) => {
    const plannedWeightsKg = Array.from(plannedSet).sort((a, b) => a - b);
    const coveredWeightsKg = Array.from(covered).sort((a, b) => a - b);
    return {
      ...row,
      plannedWeightsKg,
      coveredWeightsKg,
      missingWeightsKg: plannedWeightsKg.filter((w) => !covered.has(w)),
      status: statusFor(row.quoted + row.reusedValid, row.planned, row.incompatible),
    };
  }).sort((a, b) =>
    a.country.localeCompare(b.country)
    || a.postalCode.localeCompare(b.postalCode, undefined, { numeric: true })
    || a.profileName.localeCompare(b.profileName),
  );

  const postal = new Map<string, PostalCoverage & { incompatible: number }>();
  for (const row of finalRows) {
    const key = `${row.country}|${row.postalCode}`;
    const existing = postal.get(key) ?? {
      country: row.country, postalCode: row.postalCode, city: row.city, zoneCode: row.zoneCode,
      planned: 0, valid: 0, coveredProfiles: 0, profiles: 0, status: 'todo' as CoverageStatus, incompatible: 0,
    };
    existing.planned += row.planned;
    existing.valid += row.quoted + row.reusedValid;
    existing.incompatible += row.incompatible;
    existing.profiles++;
    if (row.status === 'complete') existing.coveredProfiles++;
    postal.set(key, existing);
  }
  const postalCodes: PostalCoverage[] = Array.from(postal.values()).map(({ incompatible, ...p }) => ({
    ...p,
    status: statusFor(p.valid, p.planned, incompatible),
  }));

  const incompatible = byClass.reused_other_postal_code + byClass.reused_incompatible + byClass.observation_missing + byClass.unverifiable;
  return {
    classifications,
    rows: finalRows,
    postalCodes,
    summary: {
      plannedPostalCodes: postalCodes.length,
      completePostalCodes: postalCodes.filter((p) => p.status === 'complete').length,
      plannedScenarios: params.items.length,
      newQuotes: byClass.quoted,
      validReuses: byClass.reused_valid,
      failed: byClass.failed,
      pending: byClass.pending,
      running: byClass.running,
      remaining: byClass.pending + byClass.running,
      incompatible,
      byClass,
      resampleCandidates: incompatible + byClass.failed,
    },
  };
}
