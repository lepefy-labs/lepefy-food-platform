import type { ShippingCampaignItemScenario, ShippingScenarioMatrix } from '@lepefy/types';

export function buildCampaignScenarios(matrix: ShippingScenarioMatrix): ShippingCampaignItemScenario[] {
  const scenarios: ShippingCampaignItemScenario[] = [];
  for (const weightKg of matrix.weightsKg) {
    for (const packagingProfileId of matrix.packagingProfileIds) {
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

export function validateScenarioMatrix(matrix: ShippingScenarioMatrix): string | null {
  if (!Array.isArray(matrix.weightsKg) || matrix.weightsKg.length === 0) return 'Sélectionnez au moins un poids représentatif.';
  if (matrix.weightsKg.some((w) => !Number.isFinite(w) || w <= 0 || w > 100)) return 'Les poids doivent être compris entre 0 et 100 kg.';
  if (!Array.isArray(matrix.packagingProfileIds) || matrix.packagingProfileIds.length === 0) return 'Sélectionnez au moins un profil d\'emballage.';
  if (!Array.isArray(matrix.destinations) || matrix.destinations.length === 0) return 'Sélectionnez au moins une destination.';
  if (matrix.destinations.some((destination) =>
    !/^[A-Z]{2}$/.test(destination.country)
    || typeof destination.postalCode !== 'string'
    || destination.postalCode.trim().length < 3
    || destination.postalCode.trim().length > 12
  )) return 'Une ou plusieurs destinations sont invalides.';

  const total = matrix.weightsKg.length * matrix.packagingProfileIds.length * matrix.destinations.length;
  if (total > 2000) return `${total} scénarios dépassent la limite d'une campagne (2000) — réduisez la matrice.`;
  return null;
}
