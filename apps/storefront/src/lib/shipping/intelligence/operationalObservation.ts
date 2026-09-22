import type { ShippingQuoteObservationRow } from '@lepefy/types';

/**
 * Coût opérationnel d'une offre provider = prix de base + taxes applicables.
 * C'est ce total — pas le seul prix de base — qui départage les services.
 * Ce n'est jamais une facture : un devis Packlink, pas une expédition payée.
 */
export function operationalCost(price: { base_price: number | null; tax_price: number | null }): number | null {
  if (price.base_price == null) return null;
  return parseFloat((Number(price.base_price) + Number(price.tax_price ?? 0)).toFixed(2));
}

export interface OfferCandidate {
  id: string | number;
  eligible: boolean;
  basePrice: number;
  taxPrice: number;
}

/**
 * Choisit l'unique offre opérationnelle d'une exécution : le service ÉLIGIBLE
 * au coût total (base + taxes) le plus bas. Un service non éligible n'est
 * jamais retenu, même moins cher. Départage stable : prix de base, puis id.
 * Retourne null si aucune offre éligible — l'exécution n'est alors pas un devis
 * exploitable.
 */
export function chooseOperationalOffer<T extends OfferCandidate>(offers: T[]): T | null {
  let best: T | null = null;
  let bestTotal = Infinity;
  for (const offer of offers) {
    if (!offer.eligible) continue;
    const total = offer.basePrice + (offer.taxPrice ?? 0);
    if (!Number.isFinite(total)) continue;
    if (
      best === null
      || total < bestTotal - 1e-9
      || (Math.abs(total - bestTotal) <= 1e-9 && (
        offer.basePrice < best.basePrice
        || (offer.basePrice === best.basePrice && String(offer.id) < String(best.id))
      ))
    ) {
      best = offer;
      bestTotal = total;
    }
  }
  return best;
}

export type OperationalObservationFields = Pick<ShippingQuoteObservationRow,
  'id' | 'request_hash' | 'observed_at' | 'eligible' | 'total_provider_cost'>;

export interface QuoteExecution<T extends OperationalObservationFields> {
  /** request_hash + observed_at : toutes les offres d'un même appel provider
   *  sont insérées dans une seule instruction et partagent donc observed_at. */
  key: string;
  requestHash: string;
  observedAt: string;
  offers: T[];
  chosen: T | null;
}

function chooseFromRows<T extends OperationalObservationFields>(rows: T[]): T | null {
  const candidates = rows
    .filter((r) => r.eligible && r.total_provider_cost != null)
    .sort((a, b) => Number(a.total_provider_cost) - Number(b.total_provider_cost) || String(a.id).localeCompare(String(b.id)));
  return candidates[0] ?? null;
}

/**
 * Regroupe des lignes d'observation (une par service provider) en exécutions
 * de scénario, et désigne pour chacune l'observation opérationnelle choisie.
 * Les alternatives restent disponibles dans `offers`.
 */
export function groupQuoteExecutions<T extends OperationalObservationFields>(rows: T[]): QuoteExecution<T>[] {
  const byKey = new Map<string, QuoteExecution<T>>();
  for (const row of rows) {
    const observedAt = new Date(row.observed_at).toISOString();
    const key = `${row.request_hash}@${observedAt}`;
    const existing = byKey.get(key);
    if (existing) existing.offers.push(row);
    else byKey.set(key, { key, requestHash: row.request_hash, observedAt, offers: [row], chosen: null });
  }
  const executions = Array.from(byKey.values());
  for (const execution of executions) execution.chosen = chooseFromRows(execution.offers);
  return executions.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.key.localeCompare(b.key));
}

/**
 * Politique statistique retenue : UN échantillon par scénario mesuré (même
 * request_hash), la dernière exécution valide. Les exécutions plus anciennes
 * du même scénario ne sont pas des tirages indépendants de la population
 * « destinations × poids » et ne gonflent donc pas l'échantillon.
 */
export function latestValidPerScenario<T extends OperationalObservationFields>(rows: T[]): Array<{ execution: QuoteExecution<T>; chosen: T; executionsForScenario: number }> {
  const executions = groupQuoteExecutions(rows);
  const byScenario = new Map<string, { execution: QuoteExecution<T>; chosen: T; executionsForScenario: number }>();
  const executionCounts = new Map<string, number>();
  for (const execution of executions) {
    if (!execution.chosen) continue;
    executionCounts.set(execution.requestHash, (executionCounts.get(execution.requestHash) ?? 0) + 1);
    // executions triées de la plus récente à la plus ancienne
    if (!byScenario.has(execution.requestHash)) {
      byScenario.set(execution.requestHash, { execution, chosen: execution.chosen, executionsForScenario: 0 });
    }
  }
  return Array.from(byScenario.values()).map((entry) => ({
    ...entry,
    executionsForScenario: executionCounts.get(entry.execution.requestHash) ?? 1,
  }));
}
