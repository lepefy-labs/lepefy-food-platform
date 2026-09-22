import type { ShippingCampaignItemScenario, ShippingScenarioDestination, ShippingScenarioMatrix } from '@lepefy/types';

export const MAX_CAMPAIGN_SCENARIOS = 2000;

export function weightsForMatrixProfile(matrix: ShippingScenarioMatrix, packagingProfileId: string): number[] {
  return matrix.weightsByProfileId?.[packagingProfileId] ?? matrix.weightsKg;
}

/** Nombre de scénarios par CAP (somme des poids de chaque profil). */
export function scenariosPerDestination(matrix: Pick<ShippingScenarioMatrix, 'weightsKg' | 'weightsByProfileId' | 'packagingProfileIds'>): number {
  return matrix.packagingProfileIds.reduce(
    (sum, id) => sum + (matrix.weightsByProfileId?.[id] ?? matrix.weightsKg).length,
    0,
  );
}

export function countScenarios(matrix: ShippingScenarioMatrix): number {
  return scenariosPerDestination(matrix) * matrix.destinations.length;
}

export function buildCampaignScenarios(matrix: ShippingScenarioMatrix): ShippingCampaignItemScenario[] {
  const scenarios: ShippingCampaignItemScenario[] = [];
  for (const packagingProfileId of matrix.packagingProfileIds) {
    for (const weightKg of weightsForMatrixProfile(matrix, packagingProfileId)) {
      for (const destination of matrix.destinations) {
        scenarios.push({
          weightKg,
          packagingProfileId,
          destination: {
            country: destination.country,
            postalCode: destination.postalCode,
            zoneCode: destination.zoneCode ?? null,
          },
        });
      }
    }
  }
  return scenarios;
}

function invalidWeights(weights: unknown): boolean {
  return !Array.isArray(weights) || weights.length === 0
    || weights.some((w) => typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || w > 100);
}

export function describeMatrixSize(matrix: ShippingScenarioMatrix): string {
  const perDestination = scenariosPerDestination(matrix);
  const profileParts = matrix.packagingProfileIds.length;
  return `${matrix.destinations.length} CAP × ${perDestination} scénario(s) par CAP (${profileParts} profil(s) × poids) = ${countScenarios(matrix)} scénarios`;
}

export function validateScenarioMatrix(matrix: ShippingScenarioMatrix): string | null {
  if (!Array.isArray(matrix.packagingProfileIds) || matrix.packagingProfileIds.length === 0) return 'Sélectionnez au moins un profil d\'emballage.';
  if (matrix.weightsByProfileId) {
    if (matrix.packagingProfileIds.some((id) => invalidWeights(matrix.weightsByProfileId?.[id]))) {
      return 'Chaque profil doit recevoir au moins un poids compris entre 0 et 100 kg.';
    }
  } else if (invalidWeights(matrix.weightsKg)) {
    return Array.isArray(matrix.weightsKg) && matrix.weightsKg.length > 0
      ? 'Les poids doivent être compris entre 0 et 100 kg.'
      : 'Sélectionnez au moins un poids représentatif.';
  }
  if (!Array.isArray(matrix.destinations) || matrix.destinations.length === 0) return 'Sélectionnez au moins une destination.';
  if (matrix.destinations.some((destination) =>
    !/^[A-Z]{2}$/.test(destination.country)
    || typeof destination.postalCode !== 'string'
    || destination.postalCode.trim().length < 3
    || destination.postalCode.trim().length > 12
  )) return 'Une ou plusieurs destinations sont invalides.';

  const total = countScenarios(matrix);
  if (total > MAX_CAMPAIGN_SCENARIOS) {
    return `${describeMatrixSize(matrix)} — au-delà de la limite d'une campagne (${MAX_CAMPAIGN_SCENARIOS}). Choisissez un préréglage plus léger ou découpez la couverture.`;
  }
  return null;
}

/**
 * Découpage déterministe d'une couverture trop large : CAP triés
 * (pays, code postal) puis regroupés en parties contiguës de taille égale
 * au possible, chacune ≤ limite. Aucun CAP ni profil n'est supprimé ; si un
 * seul CAP dépasse déjà la limite, aucun découpage par CAP n'est possible
 * (retourne []).
 */
export function splitDestinationsForLimit<T extends Pick<ShippingScenarioDestination, 'country' | 'postalCode'>>(
  destinations: T[],
  perDestinationScenarios: number,
  limit = MAX_CAMPAIGN_SCENARIOS,
): T[][] {
  if (perDestinationScenarios <= 0 || destinations.length === 0) return [];
  const maxPerPart = Math.floor(limit / perDestinationScenarios);
  if (maxPerPart < 1) return [];
  const sorted = [...destinations].sort((a, b) =>
    a.country.localeCompare(b.country) || a.postalCode.localeCompare(b.postalCode, undefined, { numeric: true }),
  );
  const partCount = Math.ceil(sorted.length / maxPerPart);
  const perPart = Math.ceil(sorted.length / partCount);
  const parts: T[][] = [];
  for (let i = 0; i < sorted.length; i += perPart) parts.push(sorted.slice(i, i + perPart));
  return parts;
}
