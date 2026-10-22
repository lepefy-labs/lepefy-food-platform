/**
 * Registre des unités de vente affichées au client (« le paquet », « la
 * bouteille »…). La base ne stocke qu'une clé (`products.sale_unit`, migration
 * 154) : ajouter une unité = une entrée ici, jamais une migration. Une clé
 * inconnue est ignorée (le prix retombe sur la quantité nette ou « l'article »).
 *
 * Imports relatifs uniquement : module partagé avec le serveur et les scripts
 * Node (type stripping, cf. scripts/ts-resolve-hooks.mjs).
 */

export interface SaleUnit {
  key: string;
  singular: string;
  plural: string;
  feminine: boolean;
  /** Vendu au poids : le prix s'entend « le kilo », sans prix de référence. */
  byWeight?: boolean;
}

const UNITS: SaleUnit[] = [
  { key: 'piece', singular: 'pièce', plural: 'pièces', feminine: true },
  { key: 'paquet', singular: 'paquet', plural: 'paquets', feminine: false },
  { key: 'sachet', singular: 'sachet', plural: 'sachets', feminine: false },
  { key: 'sac', singular: 'sac', plural: 'sacs', feminine: false },
  { key: 'filet', singular: 'filet', plural: 'filets', feminine: false },
  { key: 'boite', singular: 'boîte', plural: 'boîtes', feminine: true },
  { key: 'bouteille', singular: 'bouteille', plural: 'bouteilles', feminine: true },
  { key: 'canette', singular: 'canette', plural: 'canettes', feminine: true },
  { key: 'bidon', singular: 'bidon', plural: 'bidons', feminine: false },
  { key: 'pot', singular: 'pot', plural: 'pots', feminine: false },
  { key: 'seau', singular: 'seau', plural: 'seaux', feminine: false },
  { key: 'barquette', singular: 'barquette', plural: 'barquettes', feminine: true },
  { key: 'botte', singular: 'botte', plural: 'bottes', feminine: true },
  { key: 'regime', singular: 'régime', plural: 'régimes', feminine: false },
  { key: 'lot', singular: 'lot', plural: 'lots', feminine: false },
  { key: 'pack', singular: 'pack', plural: 'packs', feminine: false },
  { key: 'demi_carton', singular: 'demi-carton', plural: 'demi-cartons', feminine: false },
  { key: 'carton', singular: 'carton', plural: 'cartons', feminine: false },
  { key: 'kg', singular: 'kilo', plural: 'kilos', feminine: false, byWeight: true },
];

const BY_KEY = new Map(UNITS.map((unit) => [unit.key, unit]));

export const SALE_UNIT_KEYS: readonly string[] = UNITS.map((unit) => unit.key);

export function getSaleUnit(key: string | null | undefined): SaleUnit | null {
  if (!key) return null;
  return BY_KEY.get(key.trim().toLowerCase()) ?? null;
}

export function listSaleUnits(): readonly SaleUnit[] {
  return UNITS;
}

/** « le paquet », « la bouteille », « l'… » devant une voyelle ou un h muet. */
export function definiteArticle(noun: string, feminine: boolean): string {
  if (/^[aeiouyhâàéèêîïôûü]/i.test(noun)) return `l'${noun}`;
  return `${feminine ? 'la' : 'le'} ${noun}`;
}

export function unitNoun(unit: SaleUnit, count: number): string {
  return count > 1 ? unit.plural : unit.singular;
}
