export interface ShippingCityCandidate {
  country: string;
  city: string;
  stateName: string;
  stateCodes: string[];
  label: string;
}

export interface ShippingCityPostalCodes {
  country: string;
  city: string;
  stateCode: string;
  postalCodes: string[];
}

interface NominatimAddress extends Record<string, string | undefined> {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  region?: string;
  country_code?: string;
}

interface NominatimResult {
  name?: string;
  display_name: string;
  address?: NominatimAddress;
}

interface ZippopotamPlace {
  'post code'?: string;
  'postal code'?: string;
  postcode?: string;
}

const SUPPORTED_COUNTRIES = new Set(['IT', 'FR', 'BE', 'DE', 'CH']);

function normalizeCountry(value: string): string {
  return value.trim().toUpperCase();
}

function stateCodeRank(code: string): number {
  if (/^[A-Z]{2,3}$/.test(code)) return 0;
  if (/^[A-Z0-9]{1,4}$/.test(code)) return 1;
  return 2;
}

export function extractStateCodes(address: NominatimAddress): string[] {
  const codes = Object.entries(address)
    .filter(([key, value]) => key.startsWith('ISO3166-2-lvl') && typeof value === 'string' && value.trim())
    .map(([, value]) => String(value).trim().toUpperCase())
    .map((value) => value.includes('-') ? value.split('-').slice(1).join('-') : value)
    .filter((value) => /^[A-Z0-9-]{1,12}$/.test(value));

  return Array.from(new Set(codes)).sort((a, b) => stateCodeRank(a) - stateCodeRank(b) || a.localeCompare(b));
}

function cityNameFromAddress(result: NominatimResult): string {
  const address = result.address;
  return (
    address?.city
    || address?.town
    || address?.village
    || address?.municipality
    || result.name
    || ''
  ).trim();
}

export async function searchShippingCities(countryInput: string, queryInput: string): Promise<ShippingCityCandidate[]> {
  const country = normalizeCountry(countryInput);
  const query = queryInput.trim();
  if (!SUPPORTED_COUNTRIES.has(country) || query.length < 2 || query.length > 80) return [];

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', country.toLowerCase());
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '8');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'fr,it,en',
      'User-Agent': process.env.NOMINATIM_USER_AGENT ?? 'LepefyFoodPlatform/1.0',
    },
    signal: AbortSignal.timeout(5000),
    next: { revalidate: 86_400 },
  });

  if (!response.ok) return [];
  const data = await response.json() as NominatimResult[];
  const seen = new Set<string>();
  const candidates: ShippingCityCandidate[] = [];

  for (const item of data) {
    const address = item.address;
    if (!address) continue;
    const city = cityNameFromAddress(item);
    if (!city) continue;

    const resultCountry = normalizeCountry(address.country_code ?? country);
    if (resultCountry !== country) continue;

    const stateCodes = extractStateCodes(address);
    if (stateCodes.length === 0) continue;

    const stateName = (address.county || address.state || address.region || '').trim();
    const key = `${country}|${city.toLocaleLowerCase('fr-FR')}|${stateCodes.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({
      country,
      city,
      stateName,
      stateCodes,
      label: [city, stateName, country].filter(Boolean).join(' · '),
    });
  }

  return candidates.slice(0, 6);
}

interface GeoNamesPostalCode {
  postalCode?: string;
  placeName?: string;
  countryCode?: string;
  adminCode1?: string;
  adminCode2?: string;
}

function extractGeoNamesPostalCodes(payload: unknown, city: string): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const entries = Array.isArray((payload as { postalCodes?: unknown[] }).postalCodes)
    ? (payload as { postalCodes: unknown[] }).postalCodes
    : [];

  const normalizedCity = city.trim().toLocaleLowerCase('fr-FR');
  const codes = entries
    .filter((entry): entry is GeoNamesPostalCode => typeof entry === 'object' && entry !== null)
    // GeoNames renvoie parfois des lieux voisins portant un nom proche ;
    // on ne garde que les correspondances exactes du nom de ville demandé.
    .filter((entry) => (entry.placeName ?? '').trim().toLocaleLowerCase('fr-FR') === normalizedCity)
    .map((entry) => String(entry.postalCode ?? '').trim().toUpperCase())
    .filter((code) => code.length >= 3 && code.length <= 12);

  return Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Repli GeoNames : Zippopotam.us ne supporte la recherche par nom de ville
 * ("place name search") que pour un sous-ensemble restreint de pays (US, DE
 * entre autres confirmés) — l'Italie et la France, marchés principaux de ce
 * repo, n'y répondent jamais que par 404, quel que soit le code province
 * essayé. GeoNames couvre ces pays mais nécessite un compte gratuit
 * (http://www.geonames.org/login) déclaré dans GEONAMES_USERNAME.
 */
async function resolveViaGeoNames(
  country: string,
  city: string,
): Promise<string[]> {
  const username = process.env.GEONAMES_USERNAME;
  if (!username) return [];

  const url = new URL('http://api.geonames.org/postalCodeSearchJSON');
  url.searchParams.set('placename', city);
  url.searchParams.set('country', country);
  url.searchParams.set('maxRows', '50');
  url.searchParams.set('username', username);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 604_800 },
    });
    if (!response.ok) return [];
    return extractGeoNamesPostalCodes(await response.json(), city);
  } catch {
    return [];
  }
}

function extractPostalCodes(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const places = Array.isArray((payload as { places?: unknown[] }).places)
    ? (payload as { places: unknown[] }).places
    : [];

  const codes = places
    .map((place) => {
      if (!place || typeof place !== 'object') return '';
      const typed = place as ZippopotamPlace;
      return String(typed['post code'] ?? typed['postal code'] ?? typed.postcode ?? '').trim().toUpperCase();
    })
    .filter((code) => code.length >= 3 && code.length <= 12);

  return Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function resolveShippingCityPostalCodes(
  countryInput: string,
  cityInput: string,
  stateCodesInput: string[],
): Promise<ShippingCityPostalCodes | null> {
  const country = normalizeCountry(countryInput);
  const city = cityInput.trim();
  const stateCodes = Array.from(new Set(
    stateCodesInput.map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z0-9-]{1,12}$/.test(code)),
  ));

  if (!SUPPORTED_COUNTRIES.has(country) || city.length < 2 || city.length > 80 || stateCodes.length === 0) {
    return null;
  }

  for (const stateCode of stateCodes.slice(0, 5)) {
    const url = new URL(
      `https://api.zippopotam.us/${encodeURIComponent(country)}/${encodeURIComponent(stateCode)}/${encodeURIComponent(city)}`,
    );

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
        next: { revalidate: 604_800 },
      });
      if (!response.ok) continue;

      const postalCodes = extractPostalCodes(await response.json());
      if (postalCodes.length === 0) continue;

      return { country, city, stateCode, postalCodes };
    } catch {
      // Try another administrative code; manual postal entry remains the fallback.
    }
  }

  // Zippopotam.us n'implémente la recherche par nom de ville que pour un
  // sous-ensemble de pays (confirmé : ne répond jamais pour IT/FR, quel que
  // soit le code province essayé) — GeoNames couvre ces marchés.
  const geoNamesPostalCodes = await resolveViaGeoNames(country, city);
  if (geoNamesPostalCodes.length > 0) {
    return { country, city, stateCode: stateCodes[0] ?? '', postalCodes: geoNamesPostalCodes };
  }

  return null;
}
