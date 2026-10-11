/**
 * Suggestions code postal ↔ ville pour le formulaire d'adresse client, à
 * partir de l'index GeoNames interne `shipping_postal_code_index`
 * (Shipping Intelligence, migration 120 — docs/SHIPPING_INTELLIGENCE.md).
 *
 * Seules des données géographiques publiques sortent d'ici : ville,
 * province/région et codes postaux. Jamais de zone tenant, de tarif ni de
 * règle de livraison : une ville connue n'est pas une ville « livrée ».
 * Une ville à plusieurs codes postaux n'est jamais réduite à un seul code.
 * Les CAP italiens génériques d'avant réforme (41100 à côté de 41121…),
 * encore présents dans GeoNames mais refusés par les transporteurs, ne sont
 * pas proposés (même règle que le Laboratoire, zoneSentinels.ts).
 */

import { groupByAdministration, type PostalAdminRow } from '../shipping/intelligence/postalCityLookup';
import { normalizePlaceName } from '../shipping/intelligence/postalCodeImport';
import { isGenericItalianPostalCode } from '../shipping/intelligence/zoneSentinels';

export interface PostalLookupCity {
  city: string;
  /** « Reggio Emilia (RE) », ou la région si la province manque. */
  area: string | null;
  postalCodes: string[];
  /** Nombre total de codes : au-delà de MAX_POSTAL_CODES la liste est vide. */
  postalCodeCount: number;
}

export const MAX_CITIES = 8;
export const MAX_POSTAL_CODES = 30;

/** Texte de recherche d'une ville : normalisé comme l'index, sans jokers SQL. */
export function cityQueryKey(value: string): string {
  return normalizePlaceName(value).replace(/[%_\\]/g, '').replace(/\s+/g, ' ').slice(0, 60);
}

function areaLabel(adminName2: string | null, adminCode2: string | null, adminName1: string | null): string | null {
  if (adminName2) {
    return adminCode2 && /^[A-Z]{1,3}$/.test(adminCode2) && adminCode2 !== adminName2.toUpperCase()
      ? `${adminName2} (${adminCode2})`
      : adminName2;
  }
  return adminName1;
}

function withoutGenericCodes(codes: string[], country: string): string[] {
  if (country !== 'IT') return codes;
  const prefix3Counts = new Map<string, number>();
  for (const code of codes) prefix3Counts.set(code.slice(0, 3), (prefix3Counts.get(code.slice(0, 3)) ?? 0) + 1);
  return codes.filter((code) => !isGenericItalianPostalCode(code, prefix3Counts));
}

/**
 * Regroupe les lignes par commune (nom + rattachement administratif, comme le
 * Laboratoire) : deux homonymes restent deux propositions distinctes.
 * `query` (normalisé) trie la ville exacte en premier.
 */
export function buildPostalLookupCities(
  rows: Array<PostalAdminRow & { place_name_normalized?: string }>,
  country: string,
  query = '',
): PostalLookupCity[] {
  const byName = new Map<string, PostalAdminRow[]>();
  for (const row of rows) {
    const key = row.place_name_normalized ?? normalizePlaceName(row.place_name);
    const list = byName.get(key) ?? [];
    list.push(row);
    byName.set(key, list);
  }

  const cities: Array<PostalLookupCity & { key: string }> = [];
  for (const [key, nameRows] of byName) {
    for (const group of groupByAdministration(nameRows, country)) {
      const codes = withoutGenericCodes(group.postalCodes, country);
      const count = codes.length;
      cities.push({
        key,
        city: group.placeName,
        area: areaLabel(group.adminName2, group.adminCode2, group.adminName1),
        postalCodes: count <= MAX_POSTAL_CODES ? codes : [],
        postalCodeCount: count,
      });
    }
  }

  return cities
    .sort((a, b) => {
      const exact = Number(b.key === query) - Number(a.key === query);
      if (exact !== 0) return exact;
      // Les communes les plus grandes (plus de codes) d'abord, puis l'ordre alphabétique.
      if (b.postalCodeCount !== a.postalCodeCount) return b.postalCodeCount - a.postalCodeCount;
      return a.city.localeCompare(b.city, 'fr');
    })
    .slice(0, MAX_CITIES)
    .map((entry) => ({ city: entry.city, area: entry.area, postalCodes: entry.postalCodes, postalCodeCount: entry.postalCodeCount }));
}
