/**
 * « Ça rentre dans votre colis » : règles pures.
 *
 * Un produit rentre si le poids de son premier ajout (quantité minimale ×
 * poids) tient dans la marge de tranche estimée : les frais ne changent pas.
 * Produit sans poids : jamais présenté comme « livraison inchangée ».
 *
 * Fiche à plusieurs formats (187) : l'étiquette ne vaut que pour l'ajout
 * minimal de la base ; le choix du format dit, format par format, si la
 * livraison reste inchangée (`formatFitsHeadroom`).
 */

export interface ParcelFitProduct {
  id: string;
  weight_grams?: number | null;
  min_order_quantity?: number | null;
}

/** Poids ajouté par le premier clic « Ajouter » (quantité minimale), null si inconnu. */
export function firstAddWeightG(product: ParcelFitProduct): number | null {
  const weight = product.weight_grams;
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) return null;
  return Math.round(weight) * Math.max(1, Math.trunc(product.min_order_quantity ?? 1) || 1);
}

export function fitsHeadroom(product: ParcelFitProduct, headroomG: number | null | undefined): boolean {
  const added = firstAddWeightG(product);
  return added !== null && typeof headroomG === 'number' && headroomG > 0 && added <= headroomG;
}

/** Les suggestions qui rentrent, dans leur ordre de priorité, jusqu'à `limit`. */
export function selectParcelFits<T extends ParcelFitProduct>(suggestions: ReadonlyArray<T>, headroomG: number | null | undefined, limit: number): T[] {
  return suggestions.filter((product) => fitsHeadroom(product, headroomG)).slice(0, limit);
}

/**
 * « +500 g · livraison inchangée » / « +1,2 kg · livraison inchangée ».
 * `forQuantity` (fiche à formats) précise à quoi le poids se rapporte :
 * « +500 g pour 1 paquet · livraison inchangée ».
 */
export function parcelFitLabel(product: ParcelFitProduct, forQuantity?: string | null): string | null {
  const added = firstAddWeightG(product);
  if (added === null) return null;
  const weight = added < 1000 ? `${added} g` : `${(added / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;
  return `+${weight}${forQuantity ? ` pour ${forQuantity}` : ''} · livraison inchangée`;
}

/** Un format tel que proposé au choix : poids d'un exemplaire et minimum d'achat. */
export interface ParcelFitFormat {
  minimum: number;
  row: { weight_grams?: number | null };
}

/** Poids ajouté en choisissant ce format (minimum du format × poids), null si inconnu. */
export function formatAddWeightG(option: ParcelFitFormat): number | null {
  const weight = option.row.weight_grams;
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) return null;
  return Math.round(weight) * Math.max(1, Math.trunc(option.minimum) || 1);
}

/**
 * Ce format laisse-t-il la livraison inchangée ? true / false, ou null quand
 * on ne peut pas le dire (poids ou marge inconnus) : rien n'est alors affiché.
 */
export function formatFitsHeadroom(option: ParcelFitFormat, headroomG: number | null | undefined): boolean | null {
  const added = formatAddWeightG(option);
  if (added === null || typeof headroomG !== 'number' || !Number.isFinite(headroomG)) return null;
  return headroomG > 0 && added <= headroomG;
}
