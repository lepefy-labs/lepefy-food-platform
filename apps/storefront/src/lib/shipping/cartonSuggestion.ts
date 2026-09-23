import type { ShippingPackagingProfileRow } from '@lepefy/types';

/**
 * Suggestion de carton pour la préparation d'une commande (détail commande admin).
 *
 * Aide à la décision uniquement : ne modifie ni le prix facturé ni le calcul du
 * checkout (packaging_surcharges). Fonctions pures, testées unitairement.
 *
 * Découpage « rempli » : colis pleins de `maxParcelG`, puis le reste
 * (20 kg → 15 + 5). Contrairement au découpage égal du checkout (10 + 10), il
 * permet de mettre le reste dans un petit carton : même prix transporteur
 * (tarif au poids total), un carton moins cher.
 */

export type CartonProfile = Pick<ShippingPackagingProfileRow,
  'id' | 'name' | 'box_length_cm' | 'box_width_cm' | 'box_height_cm' | 'active' | 'position'
  | 'suggest_min_weight_g' | 'suggest_max_weight_g'>;

export interface ParcelCartonSuggestion {
  weightG: number;
  carton: CartonProfile | null;
  /** Autres cartons valides pour ce poids (ex. grand carton si volumineux). */
  alternatives: CartonProfile[];
}

export interface CartonSuggestion {
  totalWeightG: number;
  parcels: ParcelCartonSuggestion[];
}

export function splitParcelWeightsFilled(totalWeightG: number, maxParcelG: number): number[] {
  if (!(totalWeightG > 0) || !(maxParcelG > 0)) return [];
  const full = Math.floor(totalWeightG / maxParcelG);
  const rest = totalWeightG - full * maxParcelG;
  const parcels = Array<number>(full).fill(maxParcelG);
  if (rest > 0) parcels.push(rest);
  return parcels;
}

/** Profils utilisables pour la suggestion : actifs, avec une tranche définie. */
export function suggestionProfiles<T extends CartonProfile>(profiles: T[]): T[] {
  return profiles
    .filter((p) => p.active && typeof p.suggest_max_weight_g === 'number' && p.suggest_max_weight_g > 0)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export function cartonsForWeight<T extends CartonProfile>(weightG: number, profiles: T[]): T[] {
  return suggestionProfiles(profiles).filter((p) =>
    weightG > (p.suggest_min_weight_g ?? 0) && weightG <= (p.suggest_max_weight_g as number));
}

export function suggestCartons(
  totalWeightG: number,
  profiles: CartonProfile[],
  maxParcelG: number,
): CartonSuggestion | null {
  if (suggestionProfiles(profiles).length === 0) return null;
  const weights = splitParcelWeightsFilled(totalWeightG, maxParcelG);
  if (weights.length === 0) return null;
  return {
    totalWeightG,
    parcels: weights.map((weightG) => {
      const [carton = null, ...alternatives] = cartonsForWeight(weightG, profiles);
      return { weightG, carton, alternatives };
    }),
  };
}

/**
 * Lecture API de la tranche de suggestion (grammes). Seules les clés présentes
 * dans le corps sont renvoyées : un client qui ne les envoie pas n'écrit rien
 * (compatibilité tant que la migration 123 n'est pas appliquée).
 */
export function parseSuggestRange(body: Record<string, unknown>):
  | { ok: true; patch: { suggest_min_weight_g?: number | null; suggest_max_weight_g?: number | null } }
  | { ok: false; error: string } {
  const patch: { suggest_min_weight_g?: number | null; suggest_max_weight_g?: number | null } = {};
  for (const key of ['suggest_min_weight_g', 'suggest_max_weight_g'] as const) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw === null || raw === '' || raw === undefined) { patch[key] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || (key === 'suggest_max_weight_g' && n === 0)) {
      return { ok: false, error: 'Tranche de suggestion invalide.' };
    }
    patch[key] = Math.round(n);
  }
  const min = patch.suggest_min_weight_g;
  const max = patch.suggest_max_weight_g;
  if (min != null && 'suggest_max_weight_g' in patch && max == null) {
    return { ok: false, error: 'Indiquez le poids maximum de la tranche de suggestion.' };
  }
  if (min != null && max != null && min >= max) {
    return { ok: false, error: 'Le poids minimum de suggestion doit être inférieur au maximum.' };
  }
  return { ok: true, patch };
}

/** Regroupe les colis identiques pour l'affichage : « 2 × Carton M ». */
export function groupSuggestedCartons(suggestion: CartonSuggestion): Array<{ carton: CartonProfile | null; count: number; weightsG: number[] }> {
  const groups = new Map<string, { carton: CartonProfile | null; count: number; weightsG: number[] }>();
  for (const parcel of suggestion.parcels) {
    const key = parcel.carton?.id ?? 'none';
    const group = groups.get(key) ?? { carton: parcel.carton, count: 0, weightsG: [] };
    group.count += 1;
    group.weightsG.push(parcel.weightG);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}
