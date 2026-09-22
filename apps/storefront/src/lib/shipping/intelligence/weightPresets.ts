/**
 * Préréglages de poids de campagne — purs, partagés client (aperçu) et serveur
 * (source d'autorité à la création). Les poids dépendent de la capacité du
 * profil (max_weight_g) car c'est elle qui fixe les seuils de passage à 2, 3…
 * colis, donc les plus gros sauts de coût.
 */

export const MAX_SCENARIO_WEIGHT_KG = 100;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalize(weights: number[], maxKg: number): number[] {
  return Array.from(new Set(
    weights.map(round2).filter((w) => Number.isFinite(w) && w > 0 && w <= Math.min(maxKg, MAX_SCENARIO_WEIGHT_KG)),
  )).sort((a, b) => a - b);
}

/**
 * Couverture initiale — six points par profil de capacité M kg :
 *  - 1 kg et 3 kg : colis légers (premières tranches transporteur) ;
 *  - M/2 : milieu de capacité ;
 *  - M − 0,5 : dernier poids tenant en un colis ;
 *  - M + 0,5 : premier poids à deux colis (saut de coût le plus fréquent) ;
 *  - 2 M : deux colis pleins.
 */
export function initialCoverageWeights(maxWeightKg: number): number[] {
  const m = maxWeightKg;
  if (!Number.isFinite(m) || m <= 0) return [];
  return normalize([1, 3, m / 2, m - 0.5, m + 0.5, 2 * m], MAX_SCENARIO_WEIGHT_KG);
}

// Paliers usuels des grilles transporteur (kg) observés sur les devis Packlink.
const CARRIER_BAND_THRESHOLDS_KG = [1, 2, 3, 5, 10, 20];

/**
 * Analyse approfondie — encadre chaque palier transporteur usuel et chaque
 * multiple de la capacité du profil (1×, 2×, 3×) par des points juste
 * avant / sur / juste après, jusqu'à 3 colis pleins.
 */
export function deepAnalysisWeights(maxWeightKg: number): number[] {
  const m = maxWeightKg;
  if (!Number.isFinite(m) || m <= 0) return [];
  const ceiling = 3 * m + 1;
  const thresholds = [...CARRIER_BAND_THRESHOLDS_KG, m, 2 * m, 3 * m];
  const points = thresholds.flatMap((t) => {
    const offset = t < 5 ? 0.25 : 0.5;
    return [t - offset, t, t + offset];
  });
  return normalize(points, ceiling);
}

export type PresetSamplingMode = 'initial' | 'deep';

export function weightsForProfile(mode: PresetSamplingMode, maxWeightG: number): number[] {
  const maxKg = maxWeightG / 1000;
  return mode === 'initial' ? initialCoverageWeights(maxKg) : deepAnalysisWeights(maxKg);
}

export function buildWeightsByProfile(
  mode: PresetSamplingMode,
  profiles: Array<{ id: string; max_weight_g: number }>,
): Record<string, number[]> {
  return Object.fromEntries(profiles.map((p) => [p.id, weightsForProfile(mode, p.max_weight_g)]));
}

export function parseManualWeights(input: string): number[] {
  return input
    .split(/[,;\s]+/)
    .map((w) => Number(w.trim()))
    .filter((w) => Number.isFinite(w) && w > 0);
}
