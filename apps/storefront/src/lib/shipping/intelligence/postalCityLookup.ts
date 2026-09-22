import type { createServiceClient } from '@/lib/supabase/server';
import { normalizePlaceName } from './postalCodeImport';
import { fetchAllPages } from './pagedQuery';

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Ville candidate proposée à l'admin. Le contexte administratif est conservé
 * tout au long du parcours recherche → choix → résolution CAP → campagne :
 *  - source 'index'     : codes GeoNames exacts (adminCode1/adminCode2) ;
 *  - source 'nominatim' : codes ISO 3166-2 (stateCodes), dont la convention
 *                         peut différer de GeoNames (ex. région IT « 25 » ISO
 *                         vs « 09 » GeoNames ; la province « MI » concorde).
 */
export interface ShippingCityCandidate {
  country: string;
  city: string;
  stateName: string;
  stateCodes: string[];
  adminCode1: string | null;
  adminCode2: string | null;
  adminName1: string | null;
  adminName2: string | null;
  source: 'index' | 'nominatim';
  label: string;
}

export interface PostalAdminRow {
  place_name: string;
  admin_name1: string | null;
  admin_code1: string | null;
  admin_name2: string | null;
  admin_code2: string | null;
  postal_code: string;
}

/** Une commune = un nom + un rattachement administratif (codes GeoNames). */
export interface AdminGroup {
  placeName: string;
  adminCode1: string | null;
  adminCode2: string | null;
  adminName1: string | null;
  adminName2: string | null;
  postalCodes: string[];
  label: string;
}

export type AdministrativeMatch = 'admin_codes' | 'state_codes' | 'unique_place';

export type PostalResolution =
  | { status: 'resolved'; group: AdminGroup; matchedBy: AdministrativeMatch }
  | { status: 'ambiguous'; options: AdminGroup[] }
  | { status: 'not_found' };

export interface AdministrativeContext {
  /** Codes GeoNames exacts (candidat issu de l'index). */
  exact?: { adminCode1: string | null; adminCode2: string | null };
  /** Codes ISO 3166-2 sans préfixe pays (candidat Nominatim). */
  stateCodes?: string[];
}

function cleanCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code ? code : null;
}

function sortPostalCodes(codes: Iterable<string>): string[] {
  // Chaînes uniquement : les zéros initiaux (ex. 01000, 00118) sont préservés.
  return Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function adminGroupLabel(group: Pick<AdminGroup, 'placeName' | 'adminName1' | 'adminName2' | 'adminCode2'>, country: string): string {
  const admin2 = group.adminName2
    ? `${group.adminName2}${group.adminCode2 && group.adminCode2 !== group.adminName2.toUpperCase() ? ` (${group.adminCode2})` : ''}`
    : null;
  return [group.placeName, admin2, group.adminName1, country].filter(Boolean).join(' · ');
}

/** Regroupe les lignes GeoNames par rattachement administratif — jamais par le seul nom. */
export function groupByAdministration(rows: PostalAdminRow[], country: string): AdminGroup[] {
  const groups = new Map<string, AdminGroup & { codes: Set<string> }>();
  for (const row of rows) {
    const adminCode1 = cleanCode(row.admin_code1);
    const adminCode2 = cleanCode(row.admin_code2);
    const key = `${adminCode1 ?? ''}|${adminCode2 ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        placeName: row.place_name,
        adminCode1,
        adminCode2,
        adminName1: row.admin_name1?.trim() || null,
        adminName2: row.admin_name2?.trim() || null,
        postalCodes: [],
        label: '',
        codes: new Set(),
      };
      groups.set(key, group);
    }
    const postal = String(row.postal_code ?? '').trim().toUpperCase();
    if (postal.length >= 3 && postal.length <= 12) group.codes.add(postal);
  }
  return Array.from(groups.values())
    .map(({ codes, ...g }) => ({ ...g, postalCodes: sortPostalCodes(codes), label: adminGroupLabel(g, country) }))
    .filter((g) => g.postalCodes.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Choisit la commune à partir du contexte administratif. Ne fusionne JAMAIS
 * les CAP de communes distinctes : en cas d'ambiguïté non résoluble, renvoie
 * les options pour une sélection explicite (ou la saisie manuelle du CAP).
 */
export function resolveAdministrativeGroup(groups: AdminGroup[], context: AdministrativeContext): PostalResolution {
  if (groups.length === 0) return { status: 'not_found' };

  if (context.exact) {
    const code1 = cleanCode(context.exact.adminCode1);
    const code2 = cleanCode(context.exact.adminCode2);
    const match = groups.filter((g) => g.adminCode1 === code1 && g.adminCode2 === code2);
    if (match.length === 1) return { status: 'resolved', group: match[0]!, matchedBy: 'admin_codes' };
    return match.length > 1 ? { status: 'ambiguous', options: match } : { status: 'not_found' };
  }

  const stateCodes = new Set((context.stateCodes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean));
  if (stateCodes.size > 0) {
    // Niveau 2 (province/département) d'abord : plus discriminant, et évite
    // les collisions de numérotation entre conventions (ex. FR : région INSEE
    // « 11 » vs département « 11 »).
    const byLevel2 = groups.filter((g) => g.adminCode2 && stateCodes.has(g.adminCode2));
    const candidates = byLevel2.length > 0 ? byLevel2 : groups.filter((g) => g.adminCode1 && stateCodes.has(g.adminCode1));
    if (candidates.length === 1) return { status: 'resolved', group: candidates[0]!, matchedBy: 'state_codes' };
    if (candidates.length > 1) return { status: 'ambiguous', options: candidates };
  }

  // Conventions de codes incompatibles : n'accepter que s'il n'existe qu'une
  // seule commune de ce nom dans le pays.
  if (groups.length === 1) return { status: 'resolved', group: groups[0]!, matchedBy: 'unique_place' };
  return { status: 'ambiguous', options: groups };
}

/**
 * Recherche dans l'index interne (shipping_postal_code_index, importé
 * statiquement depuis GeoNames — voir postalCodeImport.ts) avant tout appel
 * réseau. Un candidat par commune (nom + codes administratifs).
 */
export async function searchCitiesFromIndex(
  supabase: ServiceClient,
  country: string,
  query: string,
): Promise<ShippingCityCandidate[]> {
  const normalizedQuery = normalizePlaceName(query);
  const { data } = await supabase
    .from('shipping_postal_code_index')
    .select('place_name, place_name_normalized, admin_name1, admin_code1, admin_name2, admin_code2, postal_code')
    .eq('country', country)
    .ilike('place_name_normalized', `${normalizedQuery}%`)
    .limit(200);

  const rows = (data ?? []) as Array<PostalAdminRow & { place_name_normalized: string }>;
  const seen = new Map<string, ShippingCityCandidate>();

  for (const row of rows) {
    const adminCode1 = cleanCode(row.admin_code1);
    const adminCode2 = cleanCode(row.admin_code2);
    const key = `${row.place_name_normalized}|${adminCode1 ?? ''}|${adminCode2 ?? ''}`;
    if (seen.has(key)) continue;
    const adminName1 = row.admin_name1?.trim() || null;
    const adminName2 = row.admin_name2?.trim() || null;
    seen.set(key, {
      country,
      city: row.place_name,
      stateName: adminName2 || adminName1 || '',
      stateCodes: [adminCode2, adminCode1].filter((c): c is string => Boolean(c)),
      adminCode1,
      adminCode2,
      adminName1,
      adminName2,
      source: 'index',
      label: adminGroupLabel({ placeName: row.place_name, adminName1, adminName2, adminCode2 }, country),
    });
  }

  return Array.from(seen.values()).slice(0, 8);
}

/**
 * Résout les CAP d'une commune depuis l'index interne : toutes les lignes du
 * nom (paginées), regroupées par rattachement administratif, puis sélection
 * par le contexte. Retourne not_found si l'index ne connaît pas ce nom.
 */
export async function resolvePostalCodesFromIndex(
  supabase: ServiceClient,
  country: string,
  city: string,
  context: AdministrativeContext,
): Promise<PostalResolution> {
  const normalizedCity = normalizePlaceName(city);
  const result = await fetchAllPages<PostalAdminRow>((from, to) => supabase
    .from('shipping_postal_code_index')
    .select('place_name, admin_name1, admin_code1, admin_name2, admin_code2, postal_code')
    .eq('country', country)
    .eq('place_name_normalized', normalizedCity)
    .order('postal_code', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: PostalAdminRow[] | null; error: { message: string } | null }>,
  { maxRows: 5000 });
  if (result.error) throw new Error(`postal_index_lookup_failed: ${result.error}`);
  return resolveAdministrativeGroup(groupByAdministration(result.rows, country), context);
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
      adminCode1: null,
      adminCode2: null,
      adminName1: (address.state || address.region || '').trim() || null,
      adminName2: (address.county || '').trim() || null,
      source: 'nominatim',
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
  adminName1?: string;
  adminCode2?: string;
  adminName2?: string;
}

export function geoNamesEntriesToRows(payload: unknown, city: string): PostalAdminRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const entries = Array.isArray((payload as { postalCodes?: unknown[] }).postalCodes)
    ? (payload as { postalCodes: unknown[] }).postalCodes
    : [];

  const normalizedCity = normalizePlaceName(city);
  return entries
    .filter((entry): entry is GeoNamesPostalCode => typeof entry === 'object' && entry !== null)
    // GeoNames renvoie parfois des lieux voisins portant un nom proche ;
    // on ne garde que les correspondances exactes du nom de ville demandé.
    .filter((entry) => normalizePlaceName(entry.placeName ?? '') === normalizedCity)
    .map((entry) => ({
      place_name: (entry.placeName ?? city).trim(),
      admin_name1: entry.adminName1 ?? null,
      admin_code1: entry.adminCode1 ?? null,
      admin_name2: entry.adminName2 ?? null,
      admin_code2: entry.adminCode2 ?? null,
      postal_code: String(entry.postalCode ?? ''),
    }));
}

/**
 * Repli GeoNames : Zippopotam.us ne supporte la recherche par nom de ville
 * que pour un sous-ensemble restreint de pays (IT/FR répondent toujours 404).
 * GeoNames couvre ces pays mais nécessite un compte gratuit déclaré dans
 * GEONAMES_USERNAME. Résultats regroupés par commune comme l'index interne.
 */
async function resolveViaGeoNames(country: string, city: string, context: AdministrativeContext): Promise<PostalResolution> {
  const username = process.env.GEONAMES_USERNAME;
  if (!username) return { status: 'not_found' };

  const url = new URL('http://api.geonames.org/postalCodeSearchJSON');
  url.searchParams.set('placename', city);
  url.searchParams.set('country', country);
  url.searchParams.set('maxRows', '200');
  url.searchParams.set('username', username);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 604_800 },
    });
    if (!response.ok) return { status: 'not_found' };
    return resolveAdministrativeGroup(groupByAdministration(geoNamesEntriesToRows(await response.json(), city), country), context);
  } catch {
    return { status: 'not_found' };
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

  return sortPostalCodes(codes);
}

/**
 * Repli réseau quand l'index interne ne connaît pas la commune. Zippopotam
 * est interrogé par code d'État (donc déjà circonscrit) ; GeoNames est
 * regroupé par commune et jamais fusionné entre homonymes.
 */
export async function resolveShippingCityPostalCodes(
  countryInput: string,
  cityInput: string,
  context: AdministrativeContext,
): Promise<PostalResolution> {
  const country = normalizeCountry(countryInput);
  const city = cityInput.trim();
  const stateCodes = Array.from(new Set(
    (context.stateCodes ?? []).map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z0-9-]{1,12}$/.test(code)),
  ));

  if (!SUPPORTED_COUNTRIES.has(country) || city.length < 2 || city.length > 80) {
    return { status: 'not_found' };
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

      const group: AdminGroup = {
        placeName: city, adminCode1: null, adminCode2: stateCode, adminName1: null, adminName2: null,
        postalCodes, label: `${city} · ${stateCode} · ${country}`,
      };
      return { status: 'resolved', group, matchedBy: 'state_codes' };
    } catch {
      // Try another administrative code; manual postal entry remains the fallback.
    }
  }

  return resolveViaGeoNames(country, city, { ...context, stateCodes });
}
