import type { ShippingCampaignItemScenario, ShippingScenarioMatrix } from '@lepefy/types';

/**
 * Matrice d'expérience déterministe : produit cartésien poids × profils ×
 * destinations. Pas de génération aléatoire — chaque combinaison de la
 * matrice fournie par l'admin devient un scénario, un par ligne de
 * shipping_simulation_campaign_items.
 */
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
  if (!Array.isArray(matrix.weightsKg) || matrix.weightsKg.length === 0) {
    return 'Sélectionnez au moins un poids représentatif.';
  }
  if (matrix.weightsKg.some((w) => !Number.isFinite(w) || w <= 0 || w > 100)) {
    return 'Les poids doivent être compris entre 0 et 100 kg.';
  }
  if (!Array.isArray(matrix.packagingProfileIds) || matrix.packagingProfileIds.length === 0) {
    return 'Sélectionnez au moins un profil d\'emballage.';
  }
  if (!Array.isArray(matrix.destinations) || matrix.destinations.length === 0) {
    return 'Sélectionnez au moins une destination.';
  }
  const total = matrix.weightsKg.length * matrix.packagingProfileIds.length * matrix.destinations.length;
  if (total > 500) {
    return `${total} scénarios dépassent la limite d'une campagne (500) — réduisez la matrice.`;
  }
  return null;
}
