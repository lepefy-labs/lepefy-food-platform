/**
 * Poids d'emballage par tranche (migration 180) : fonctions pures, seule source
 * de la règle. La tranche est évaluée sur le poids NET TOTAL de la commande, le
 * poids ajouté est réparti entre les colis au prorata de leur poids net.
 *
 * Il modifie uniquement le poids envoyé au provider (devis sans forfait,
 * disponibilité du forfait, bozza) : jamais le prix du forfait, le nombre de
 * colis, le carton suggéré ni `shipping_details.totalWeightG`, qui restent nets.
 * Avec des tranches, `tare_g` du carton est ignoré (jamais additionné).
 */

export const MAX_PACKAGING_WEIGHT_BANDS = 20;
export const MAX_PACKAGING_ADDED_WEIGHT_G = 20_000;

export interface PackagingWeightBand {
  /** Borne basse exclue (g). */
  minWeightGExclusive: number;
  /** Borne haute incluse (g) ; null = tranche ouverte. */
  maxWeightGInclusive: number | null;
  addedWeightG: number;
}

export interface PackagingWeightBandRow {
  min_weight_g_exclusive: number;
  max_weight_g_inclusive: number | null;
  added_weight_g: number;
}

export function bandsFromRows(rows: readonly PackagingWeightBandRow[]): PackagingWeightBand[] {
  return rows
    .map((row) => ({
      minWeightGExclusive: Number(row.min_weight_g_exclusive),
      maxWeightGInclusive: row.max_weight_g_inclusive === null ? null : Number(row.max_weight_g_inclusive),
      addedWeightG: Number(row.added_weight_g),
    }))
    .sort((a, b) => a.minWeightGExclusive - b.minWeightGExclusive);
}

export function bandsToRows(bands: readonly PackagingWeightBand[]): PackagingWeightBandRow[] {
  return bands.map((band) => ({
    min_weight_g_exclusive: band.minWeightGExclusive,
    max_weight_g_inclusive: band.maxWeightGInclusive,
    added_weight_g: band.addedWeightG,
  }));
}

/** Poids d'emballage de la commande (g) ; 0 sans tranche applicable. */
export function packagingWeightForOrder(netWeightG: number, bands: readonly PackagingWeightBand[]): number {
  if (!(netWeightG > 0)) return 0;
  const band = bands.find((b) => netWeightG > b.minWeightGExclusive && (b.maxWeightGInclusive === null || netWeightG <= b.maxWeightGInclusive));
  return band?.addedWeightG ?? 0;
}

/** Répartition au prorata, en grammes entiers : la somme vaut toujours `addedG`. */
export function distributeAddedWeight(addedG: number, parcelsNetG: readonly number[]): number[] {
  const totalNet = parcelsNetG.reduce((sum, g) => sum + g, 0);
  if (!(addedG > 0) || !(totalNet > 0)) return parcelsNetG.map(() => 0);
  const shares = parcelsNetG.map((g, index) => {
    const exact = (addedG * g) / totalNet;
    return { index, grams: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let missing = addedG - shares.reduce((sum, share) => sum + share.grams, 0);
  for (const share of [...shares].sort((a, b) => b.rest - a.rest || a.index - b.index)) {
    if (missing <= 0) break;
    share.grams += 1;
    missing -= 1;
  }
  return shares.map((share) => share.grams);
}

/** Poids de chaque colis tel qu'envoyé au provider, dans l'ordre des colis. */
export function grossParcelWeights(parcelsNetG: readonly number[], bands: readonly PackagingWeightBand[]): number[] {
  const totalNet = parcelsNetG.reduce((sum, g) => sum + g, 0);
  const added = distributeAddedWeight(packagingWeightForOrder(totalNet, bands), parcelsNetG);
  return parcelsNetG.map((g, index) => g + added[index]!);
}

export type PackagingWeightBandsInput =
  | { ok: true; bands: PackagingWeightBand[] }
  | { ok: false; error: string };

/**
 * Lecture de la liste saisie : `[{ maxWeightG, addedWeightG }]` triée par poids,
 * dernière tranche ouverte (maxWeightG null). Les bornes basses sont déduites,
 * donc aucune tranche ne peut se chevaucher. Liste vide = fonction désactivée.
 */
export function parsePackagingWeightBandsInput(raw: unknown): PackagingWeightBandsInput {
  if (!Array.isArray(raw)) return { ok: false, error: 'Liste de tranches invalide.' };
  if (raw.length > MAX_PACKAGING_WEIGHT_BANDS) return { ok: false, error: `${MAX_PACKAGING_WEIGHT_BANDS} tranches au maximum.` };
  const bands: PackagingWeightBand[] = [];
  let min = 0;
  for (const [index, item] of raw.entries()) {
    const row = (item ?? {}) as { maxWeightG?: unknown; addedWeightG?: unknown };
    const isLast = index === raw.length - 1;
    const added = row.addedWeightG;
    if (typeof added !== 'number' || !Number.isInteger(added) || added < 0 || added > MAX_PACKAGING_ADDED_WEIGHT_G) {
      return { ok: false, error: 'Poids ajouté invalide (0 à 20 kg).' };
    }
    if (isLast) {
      if (row.maxWeightG !== null) return { ok: false, error: 'La dernière tranche doit rester sans limite.' };
      bands.push({ minWeightGExclusive: min, maxWeightGInclusive: null, addedWeightG: added });
      break;
    }
    const max = row.maxWeightG;
    if (typeof max !== 'number' || !Number.isInteger(max) || max <= min) {
      return { ok: false, error: 'Les limites de poids doivent être croissantes.' };
    }
    bands.push({ minWeightGExclusive: min, maxWeightGInclusive: max, addedWeightG: added });
    min = max;
  }
  return { ok: true, bands };
}
