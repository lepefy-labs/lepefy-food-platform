import type { ShippingZoneRow } from '@lepefy/types';
import { resolveZoneCodeFromRows } from './resolveZone';
import { normalizePostalCode } from './requestIdentity';

/**
 * « Couverture par zone » : les devis Packlink observés ne varient pas d'un
 * CAP à l'autre d'une même zone tarifaire (poids et dimensions font le prix).
 * Plutôt que de mesurer tous les CAP, on mesure quelques CAP témoins par zone,
 * choisis de façon déterministe dans l'index GeoNames.
 */

export interface PostalCandidate {
  postalCode: string;
  city: string;
  adminCode2: string | null;
}

export interface ZoneSentinelPlan {
  /** null = CAP ne relevant d'aucune zone active du tenant. */
  zoneCode: string | null;
  candidates: number;
  sentinels: PostalCandidate[];
  excludedGeneric: number;
  excludedRejected: number;
}

export const MIN_SENTINELS_PER_ZONE = 1;
export const MAX_SENTINELS_PER_ZONE = 3;

/**
 * CAP générique d'avant réforme (IT) : se termine par « 00 » alors que la
 * même racine à 3 chiffres possède des CAP subdivisés (ex. 40100 vs 40121…).
 * 21100 (Varese) reste valide : aucun autre CAP 211xx.
 */
export function isGenericItalianPostalCode(code: string, prefix3Counts: Map<string, number>): boolean {
  if (!/^\d{5}$/.test(code) || !code.endsWith('00')) return false;
  return (prefix3Counts.get(code.slice(0, 3)) ?? 0) > 1;
}

/** Sélection déterministe et répartie : n points régulièrement espacés dans la liste triée. */
export function selectSpread<T>(sorted: T[], n: number): T[] {
  if (n >= sorted.length) return [...sorted];
  const picks: T[] = [];
  for (let i = 0; i < n; i++) {
    picks.push(sorted[Math.floor(((2 * i + 1) * sorted.length) / (2 * n))]!);
  }
  return picks;
}

/**
 * 1er témoin : un CAP (médian) de la plus grande ville de la zone ; les
 * suivants : répartis parmi les autres localités (périphérie, où des
 * suppléments « località disagiate » peuvent apparaître).
 */
export function pickSentinels(sorted: Array<PostalCandidate & { placeSize: number }>, n: number): PostalCandidate[] {
  if (sorted.length === 0 || n <= 0) return [];
  const main = sorted.reduce((best, c) => (c.placeSize > best.placeSize ? c : best), sorted[0]!);
  const mainPlace = `${main.city}|${main.adminCode2 ?? ''}`;
  const mainCodes = sorted.filter((c) => `${c.city}|${c.adminCode2 ?? ''}` === mainPlace);
  const first = mainCodes[Math.floor((mainCodes.length - 1) / 2)]!;
  const others = sorted.filter((c) => `${c.city}|${c.adminCode2 ?? ''}` !== mainPlace);
  const rest = selectSpread(others.length > 0 ? others : sorted.filter((c) => c !== first), n - 1);
  return [first, ...rest].map(({ postalCode, city, adminCode2 }) => ({ postalCode, city, adminCode2 }));
}

export function planZoneSentinels(params: {
  country: string;
  zones: ShippingZoneRow[];
  candidates: PostalCandidate[];
  perZone: number;
  rejectedPostalCodes: Set<string>;
  includeUnzoned?: boolean;
}): ZoneSentinelPlan[] {
  const country = params.country.trim().toUpperCase();
  const perZone = Math.min(Math.max(Math.round(params.perZone), MIN_SENTINELS_PER_ZONE), MAX_SENTINELS_PER_ZONE);
  const zones = params.zones.filter((z) => z.active && z.country.toUpperCase() === country);

  // GeoNames associe plusieurs lieux (frazioni) à un même CAP. Taille d'un
  // lieu = nombre de CAP distincts qu'il porte : une ville subdivisée en a
  // beaucoup. Chaque CAP prend pour libellé son lieu le plus « grand ».
  const placeKey = (c: PostalCandidate) => `${c.city.trim().toLowerCase()}|${c.adminCode2 ?? ''}`;
  const placeCodes = new Map<string, Set<string>>();
  for (const candidate of params.candidates) {
    const postalCode = normalizePostalCode(candidate.postalCode);
    const key = placeKey(candidate);
    (placeCodes.get(key) ?? placeCodes.set(key, new Set()).get(key)!).add(postalCode);
  }
  const placeSize = (c: PostalCandidate) => placeCodes.get(placeKey(c))?.size ?? 0;

  const unique = new Map<string, PostalCandidate & { placeSize: number }>();
  for (const candidate of params.candidates) {
    const postalCode = normalizePostalCode(candidate.postalCode);
    if (postalCode.length < 3) continue;
    const size = placeSize(candidate);
    const existing = unique.get(postalCode);
    if (!existing || size > existing.placeSize || (size === existing.placeSize && candidate.city < existing.city)) {
      unique.set(postalCode, { ...candidate, postalCode, placeSize: size });
    }
  }
  const prefix3Counts = new Map<string, number>();
  for (const code of unique.keys()) prefix3Counts.set(code.slice(0, 3), (prefix3Counts.get(code.slice(0, 3)) ?? 0) + 1);

  const groups = new Map<string | null, { valid: Array<PostalCandidate & { placeSize: number }>; generic: number; rejected: number }>();
  for (const zone of zones) groups.set(zone.code, { valid: [], generic: 0, rejected: 0 });

  for (const candidate of unique.values()) {
    const zoneCode = resolveZoneCodeFromRows(zones, country, candidate.postalCode);
    if (zoneCode === null && !params.includeUnzoned) continue;
    const group = groups.get(zoneCode) ?? { valid: [], generic: 0, rejected: 0 };
    groups.set(zoneCode, group);
    if (country === 'IT' && isGenericItalianPostalCode(candidate.postalCode, prefix3Counts)) group.generic++;
    else if (params.rejectedPostalCodes.has(candidate.postalCode)) group.rejected++;
    else group.valid.push(candidate);
  }

  const zoneOrder = new Map(zones.map((z, i) => [z.code, z.position ?? i]));
  return Array.from(groups.entries())
    .map(([zoneCode, group]) => {
      const sorted = [...group.valid].sort((a, b) => a.postalCode.localeCompare(b.postalCode, undefined, { numeric: true }));
      return {
        zoneCode,
        candidates: sorted.length,
        sentinels: pickSentinels(sorted, perZone),
        excludedGeneric: group.generic,
        excludedRejected: group.rejected,
      };
    })
    .sort((a, b) => {
      if (a.zoneCode === null) return 1;
      if (b.zoneCode === null) return -1;
      return (zoneOrder.get(a.zoneCode) ?? 0) - (zoneOrder.get(b.zoneCode) ?? 0) || a.zoneCode.localeCompare(b.zoneCode);
    });
}
