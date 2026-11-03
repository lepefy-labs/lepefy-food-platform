/**
 * Pure destination check of a Packlink draft. Lepefy keeps Sicily and Sardinia
 * inside Italy (country `IT`, customer side untouched); Packlink PRO lists them
 * as their own destination zones ("Sicilia - Italia", "Sardegna - Italia"). The
 * zone is never guessed: it comes from the provider's postal-code record and
 * zone list, and an Italian island address whose provider zone does not agree
 * stops the draft instead of attributing it to the wrong zone.
 *
 * Verified read-only against the live API (03/11/2026): postalcodes/IT/{zip}
 * answers with `postalZoneId` 115 (it_IT name "Sicilia- Italia") for Sicily and
 * 114 ("Sardegna- Italia") for Sardinia, 113 ("Italia") for the mainland; special
 * zones also exist (Livigno 251, Campione d'Italia 252). The default zone name
 * is not in Italian ("Italia - Cerdeña"), hence the `it_IT` language of the lookup.
 */

export type ItalianIsland = 'sicily' | 'sardinia';

/** Official Italian CAP ranges: 90xxx-98xxx Sicily, 07xxx-09xxx Sardinia. */
export function italianIslandOfPostalCode(country: string, postalCode: string): ItalianIsland | null {
  if (country !== 'IT' || !/^\d{5}$/.test(postalCode)) return null;
  const prefix = Number(postalCode.slice(0, 2));
  if (prefix >= 90 && prefix <= 98) return 'sicily';
  if (prefix >= 7 && prefix <= 9) return 'sardinia';
  return null;
}

/** Island named by a Packlink zone name ("Sicilia - Italia", "Sardegna - Italia", English variants). */
export function italianIslandOfZoneName(zoneName: string | null | undefined): ItalianIsland | null {
  const name = (zoneName ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (/sicil/.test(name)) return 'sicily';
  if (/sardegn|sardin|cerde/.test(name)) return 'sardinia';
  return null;
}

export type DestinationCheck =
  | { ok: true }
  | { ok: false; reason: 'island_zone_unresolved' | 'island_zone_mismatch' };

/**
 * `zoneName` is the provider name of the resolved postal zone (null when the
 * CAP or the zone could not be resolved). Only Italy is checked: other
 * countries and mainland addresses keep the previous behaviour (an unresolved
 * mainland CAP still sends `zip_code` alone).
 */
export function checkPacklinkDestination(
  country: string, postalCode: string, zoneName: string | null | undefined,
): DestinationCheck {
  if (country !== 'IT') return { ok: true };
  const expected = italianIslandOfPostalCode(country, postalCode);
  const actual = italianIslandOfZoneName(zoneName);
  if (expected) {
    if (!zoneName) return { ok: false, reason: 'island_zone_unresolved' };
    return actual === expected ? { ok: true } : { ok: false, reason: 'island_zone_mismatch' };
  }
  // A mainland CAP must never land in an island zone.
  return actual ? { ok: false, reason: 'island_zone_mismatch' } : { ok: true };
}
