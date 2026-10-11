/**
 * Recherche d'adresse pour la « Recherche rapide » du formulaire client.
 *
 * Provider : Photon (photon.komoot.io, données OpenStreetMap), conçu pour la
 * recherche pendant la saisie — contrairement à Nominatim, dont la politique
 * d'usage interdit l'autocomplétion. Un résultat n'est qu'une aide au
 * remplissage : jamais une adresse « validée » ni « livrable ».
 */

export interface AddressSuggestion {
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  country: string;
  /** « Via Roma 25 » */
  primary: string;
  /** « 42121 Reggio Emilia » */
  secondary: string;
}

interface PhotonProperties {
  type?: string;
  name?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  locality?: string;
  district?: string;
  county?: string;
  countrycode?: string;
}

interface PhotonFeature {
  properties?: PhotonProperties;
}

export const MAX_SUGGESTIONS = 5;

/** Emprise approximative (minLon,minLat,maxLon,maxLat) : limite la recherche au pays choisi. */
export const COUNTRY_BBOX: Record<string, string> = {
  IT: '6.6,35.4,18.6,47.1',
  FR: '-5.2,41.3,9.6,51.1',
  BE: '2.5,49.5,6.4,51.5',
  DE: '5.8,47.2,15.1,55.1',
  CH: '5.9,45.8,10.5,47.9',
};

/** Ne garde que des rues ou des adresses du pays demandé, sans doublons. */
export function photonToSuggestions(payload: unknown, country: string): AddressSuggestion[] {
  const features = (payload as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const wanted = country.toUpperCase();
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];

  for (const feature of features) {
    const p = feature?.properties;
    if (!p || (p.countrycode ?? '').toUpperCase() !== wanted) continue;

    let street = '';
    let houseNumber = '';
    if (p.type === 'house' && p.street) {
      street = p.street;
      houseNumber = p.housenumber ?? '';
    } else if (p.type === 'street' && p.name) {
      street = p.name;
    } else {
      continue;
    }

    const city = (p.city || p.town || p.village || p.locality || p.district || p.county || '').trim();
    const postalCode = (p.postcode ?? '').split(/[;,]/)[0]?.trim() ?? '';
    if (!city && !postalCode) continue;

    const primary = [street.trim(), houseNumber.trim()].filter(Boolean).join(' ');
    const secondary = [postalCode, city].filter(Boolean).join(' ');
    const key = `${primary}|${secondary}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ street: street.trim(), houseNumber: houseNumber.trim(), postalCode, city, country: wanted, primary, secondary });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}
