/**
 * Pure helpers for the admin shipping configuration (/admin/livraison),
 * shared by the page, the shipping-rules / shipping-zones API routes and unit
 * tests. Nothing here changes how a customer quote is computed: the preview
 * and the zone lookup call the very functions the quote paths use
 * (applyCountryRule, resolveZoneCodeFromRows).
 */
import { applyCountryRule, type ShippingCountryRule } from './resolveCountryRule';

export const ALL_COUNTRIES = '*';

export interface RuleLike {
  id: string;
  countries: string[];
  active: boolean;
}

export interface CountryRuleConflict {
  country: string;
  ruleIds: string[];
}

/**
 * Explicit countries listed in more than one ACTIVE rule. resolveCountryRule
 * takes the first match of an unordered set, so the rule applied to such a
 * country is not determined. The '*' fallback is not a conflict: an explicit
 * country rule always wins over it.
 */
export function findCountryRuleConflicts(rules: RuleLike[]): CountryRuleConflict[] {
  const byCountry = new Map<string, string[]>();
  for (const rule of rules) {
    if (!rule.active || rule.countries.includes(ALL_COUNTRIES)) continue;
    for (const country of new Set(rule.countries.map((c) => c.toUpperCase()))) {
      byCountry.set(country, [...(byCountry.get(country) ?? []), rule.id]);
    }
  }
  return [...byCountry.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([country, ruleIds]) => ({ country, ruleIds }))
    .sort((a, b) => a.country.localeCompare(b.country));
}

/**
 * Countries a candidate (created, edited or re-activated) rule would share
 * with another active rule. Empty when the candidate is inactive or '*'.
 */
export function overlappingCountries(
  candidate: { id?: string | null; countries: string[]; active: boolean },
  others: RuleLike[],
): string[] {
  if (!candidate.active || candidate.countries.includes(ALL_COUNTRIES)) return [];
  const wanted = new Set(candidate.countries.map((c) => c.toUpperCase()));
  const hits = new Set<string>();
  for (const rule of others) {
    if (rule.id === candidate.id || !rule.active || rule.countries.includes(ALL_COUNTRIES)) continue;
    for (const country of rule.countries) if (wanted.has(country.toUpperCase())) hits.add(country.toUpperCase());
  }
  return [...hits].sort();
}

const COUNTRY_NAMES: Record<string, string> = {
  IT: 'Italie', FR: 'France', BE: 'Belgique', DE: 'Allemagne', CH: 'Suisse',
};

export function countryName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

export function overlapMessage(countries: string[]): string {
  const names = countries.map(countryName).join(', ');
  return countries.length > 1
    ? `${names} sont déjà couverts par une autre règle active. Une seule règle active par pays.`
    : `${names} est déjà couvert par une autre règle active. Une seule règle active par pays.`;
}

/** Customer price for an example base cost and cart, through the quote's own applyCountryRule. */
export function previewCountryRule(baseCost: number, cartSubtotal: number, rule: ShippingCountryRule) {
  return applyCountryRule(baseCost, cartSubtotal, rule);
}

export interface ZoneLike {
  id: string;
  code: string;
  country: string;
  postal_prefixes: string[];
  active: boolean;
}

export interface PrefixConflict {
  country: string;
  prefix: string;
  zoneCodes: string[];
}

/**
 * The same prefix in two active zones of one country: the longest-prefix rule
 * of resolveZoneCodeFromRows cannot separate them, so the zone is ambiguous.
 * (A longer prefix inside a shorter one — 30121 vs 30 — is intended.)
 */
export function findZonePrefixConflicts(zones: ZoneLike[]): PrefixConflict[] {
  const seen = new Map<string, { country: string; prefix: string; codes: Set<string> }>();
  for (const zone of zones) {
    if (!zone.active) continue;
    const country = zone.country.toUpperCase();
    for (const raw of zone.postal_prefixes) {
      const prefix = raw.trim().toUpperCase();
      if (!prefix) continue;
      const key = `${country}:${prefix}`;
      const entry = seen.get(key) ?? { country, prefix, codes: new Set<string>() };
      entry.codes.add(zone.code);
      seen.set(key, entry);
    }
  }
  return [...seen.values()]
    .filter((entry) => entry.codes.size > 1)
    .map((entry) => ({ country: entry.country, prefix: entry.prefix, zoneCodes: [...entry.codes].sort() }))
    .sort((a, b) => a.country.localeCompare(b.country) || a.prefix.localeCompare(b.prefix));
}

/** Prefixes of a candidate zone already used by another active zone of the same country. */
export function duplicatePrefixes(
  candidate: { id?: string | null; country: string; postal_prefixes: string[]; active: boolean },
  others: ZoneLike[],
): string[] {
  if (!candidate.active) return [];
  const country = candidate.country.toUpperCase();
  const wanted = new Set(candidate.postal_prefixes.map((p) => p.trim().toUpperCase()).filter(Boolean));
  const hits = new Set<string>();
  for (const zone of others) {
    if (zone.id === candidate.id || !zone.active || zone.country.toUpperCase() !== country) continue;
    for (const prefix of zone.postal_prefixes) if (wanted.has(prefix.trim().toUpperCase())) hits.add(prefix.trim().toUpperCase());
  }
  return [...hits].sort();
}

export interface ZoneMatchExplanation {
  zoneCode: string | null;
  matchedPrefix: string | null;
  /** Shorter matches the winning prefix took priority over, e.g. "30 · IT_VENETO". */
  overridden: Array<{ zoneCode: string; prefix: string }>;
}

/**
 * Which zone a postal code falls into and why. Mirrors resolveZoneCodeFromRows
 * (active zones of the country, longest matching prefix wins).
 */
export function explainZoneMatch(zones: ZoneLike[], country: string, postalCode: string): ZoneMatchExplanation {
  const normalizedCountry = country.trim().toUpperCase();
  const code = postalCode.trim().toUpperCase();
  const matches: Array<{ zoneCode: string; prefix: string }> = [];
  for (const zone of zones) {
    if (!zone.active || zone.country.toUpperCase() !== normalizedCountry) continue;
    for (const prefix of zone.postal_prefixes) {
      const p = prefix.trim().toUpperCase();
      if (p && code.startsWith(p)) matches.push({ zoneCode: zone.code, prefix: p });
    }
  }
  if (!code || matches.length === 0) return { zoneCode: null, matchedPrefix: null, overridden: [] };
  // Stable: first zone wins ties, like resolveZoneCodeFromRows' reduce.
  const best = matches.reduce((winner, match) => (match.prefix.length > winner.prefix.length ? match : winner));
  return {
    zoneCode: best.zoneCode,
    matchedPrefix: best.prefix,
    overridden: matches.filter((m) => m.zoneCode !== best.zoneCode && m.prefix.length < best.prefix.length),
  };
}

export function groupZonesByCountry<T extends ZoneLike>(zones: T[]): Array<{ country: string; zones: T[] }> {
  const groups = new Map<string, T[]>();
  for (const zone of zones) {
    const country = zone.country.toUpperCase();
    groups.set(country, [...(groups.get(country) ?? []), zone]);
  }
  return [...groups.entries()].map(([country, list]) => ({ country, zones: list }));
}
