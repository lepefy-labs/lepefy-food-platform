/**
 * Pure rules of the single « Code postal et localité » control. The data model
 * keeps `postalCode` and `city` apart; the control only guides the choice from
 * the postal code (index `shipping_postal_code_index`, never an invented pair).
 */

import type { PostalLookupCity } from './postalLookup';

const plain = (text: string) => text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

export function sameLocality(a: string, b: string): boolean {
  return plain(a) === plain(b);
}

/** « 90133 - Palermo » (what the control shows once a locality is chosen). */
export function localityLabel(postalCode: string, city: string): string {
  return `${postalCode} - ${city}`;
}

/** Digits typed in the control (a label such as « 90133 - Palermo » yields its code), cut to the country length. */
export function postalDigitsFromInput(raw: string, maxDigits: number): string {
  return raw.replace(/\D/g, '').slice(0, maxDigits);
}

export type LocalityAction =
  | { kind: 'keep' }
  | { kind: 'select'; city: string }
  | { kind: 'clear' };

/**
 * What to do with the current city once the index answered for the postal code.
 * - the city is one of the answers: keep (the pair is consistent);
 * - a single answer and no city (or a city we set ourselves): preselect it;
 * - several answers and a city that matches none: clear, the customer picks;
 * - no answer: keep (manual path, nothing is guessed).
 */
export function reconcileLocality(cities: PostalLookupCity[], city: string): LocalityAction {
  if (cities.length === 0) return { kind: 'keep' };
  if (cities.some((entry) => sameLocality(entry.city, city))) return { kind: 'keep' };
  if (cities.length === 1 && !city.trim()) return { kind: 'select', city: cities[0]!.city };
  return city.trim() ? { kind: 'clear' } : { kind: 'keep' };
}
