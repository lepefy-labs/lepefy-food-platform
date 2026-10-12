/**
 * Règles des zones de livraison de la location de matériel, partagées par
 * l'admin (formulaire) et les API (POST/PATCH des zones, réglages du tenant).
 * Fonctions pures, imports relatifs uniquement.
 *
 * Une zone couvre une seule chose : tout le pays, des débuts de code postal
 * ou une ville. Le calcul reste celui de matchDeliveryZone().
 */

import { COUNTRY_ADDRESS_RULES, countryLabel, isDeliveryCountry } from '../address/addressRules';
import { normalizeZoneCity } from './matchDeliveryZone';

export type DeliveryZoneKind = 'country' | 'postal' | 'city';

export const DELIVERY_ZONE_KINDS: Array<{ value: DeliveryZoneKind; label: string }> = [
  { value: 'country', label: 'Tout le pays' },
  { value: 'postal', label: 'Codes postaux' },
  { value: 'city', label: 'Une ville' },
];

export const DELIVERY_ZONE_LIMITS = { label: 80, city: 80, note: 300, prefixes: 50, fee: 10000, countries: 30 } as const;

export type DeliveryZoneField = 'label' | 'country' | 'kind' | 'postal_code_prefixes' | 'city' | 'fee_amount' | 'note';

export interface NormalizedDeliveryZone {
  label: string;
  country: string;
  postal_code_prefixes: string[] | null;
  city: string | null;
  fee_amount: number;
  note: string | null;
  active: boolean;
}

export type NormalizeDeliveryZoneResult =
  | { ok: true; zone: NormalizedDeliveryZone; kind: DeliveryZoneKind }
  | { ok: false; field: DeliveryZoneField; error: string };

interface ZoneShape {
  postal_code_prefixes: string[] | null;
  city: string | null;
}

/** Ce que couvre une zone enregistrée (les codes postaux priment, comme au calcul). */
export function deliveryZoneKind(zone: ZoneShape): DeliveryZoneKind {
  if ((zone.postal_code_prefixes ?? []).some((prefix) => prefix && prefix.trim())) return 'postal';
  if (zone.city && zone.city.trim()) return 'city';
  return 'country';
}

/** « 421, 422 » ou « 421 422 » → ['421', '422'] (majuscules, sans doublons). */
export function parsePostalPrefixes(value: string | ReadonlyArray<unknown>): string[] {
  const parts = typeof value === 'string'
    ? value.split(/[,;\s]+/)
    : value.flatMap((entry) => String(entry ?? '').split(/[,;\s]+/));
  return [...new Set(parts.map((part) => part.trim().toUpperCase()).filter(Boolean))];
}

function prefixError(country: string, prefix: string): string | null {
  if (isDeliveryCountry(country)) {
    const digits = COUNTRY_ADDRESS_RULES[country].postalDigits;
    if (!/^\d+$/.test(prefix) || prefix.length > digits) {
      return `« ${prefix} » : uniquement des chiffres, ${digits} au maximum pour ${countryWithArticle(country)}.`;
    }
    return null;
  }
  return /^[A-Z0-9]{1,10}$/.test(prefix) ? null : `« ${prefix} » : uniquement des lettres et des chiffres.`;
}

function countryWithArticle(country: string): string {
  const name = countryLabel(country);
  if (country === 'IT' || country === 'DE') return `l’${name}`;
  if (country === 'FR' || country === 'BE' || country === 'CH') return `la ${name}`;
  return name;
}

function cleanText(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().replace(/\s+/g, ' ') : '';
}

function parseFee(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value.trim().replace(',', '.'));
  return Number.NaN;
}

function isKind(value: unknown): value is DeliveryZoneKind {
  return value === 'country' || value === 'postal' || value === 'city';
}

/**
 * Contrôle d'une zone envoyée par l'admin. `kind` absent : déduit des champs.
 * Seuls les champs du type choisi sont conservés (les autres passent à null).
 */
export function normalizeDeliveryZone(raw: Record<string, unknown>): NormalizeDeliveryZoneResult {
  const label = cleanText(raw.label);
  if (!label) return { ok: false, field: 'label', error: 'Indiquez le nom de la zone.' };
  if (label.length > DELIVERY_ZONE_LIMITS.label) return { ok: false, field: 'label', error: `Nom trop long (${DELIVERY_ZONE_LIMITS.label} caractères au maximum).` };

  const country = cleanText(raw.country).toUpperCase();
  if (!country) return { ok: false, field: 'country', error: 'Choisissez le pays de la zone.' };
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, field: 'country', error: 'Pays invalide.' };

  const prefixesRaw = Array.isArray(raw.postal_code_prefixes) || typeof raw.postal_code_prefixes === 'string'
    ? parsePostalPrefixes(raw.postal_code_prefixes as string | unknown[])
    : [];
  const cityRaw = cleanText(raw.city);
  const kind: DeliveryZoneKind = isKind(raw.kind)
    ? raw.kind
    : deliveryZoneKind({ postal_code_prefixes: prefixesRaw, city: cityRaw || null });

  let prefixes: string[] | null = null;
  let city: string | null = null;
  if (kind === 'postal') {
    if (prefixesRaw.length === 0) return { ok: false, field: 'postal_code_prefixes', error: 'Indiquez au moins un début de code postal.' };
    if (prefixesRaw.length > DELIVERY_ZONE_LIMITS.prefixes) return { ok: false, field: 'postal_code_prefixes', error: `${DELIVERY_ZONE_LIMITS.prefixes} débuts de code postal au maximum.` };
    for (const prefix of prefixesRaw) {
      const error = prefixError(country, prefix);
      if (error) return { ok: false, field: 'postal_code_prefixes', error };
    }
    prefixes = prefixesRaw;
  } else if (kind === 'city') {
    if (!cityRaw || !normalizeZoneCity(cityRaw)) return { ok: false, field: 'city', error: 'Indiquez la ville.' };
    if (cityRaw.length > DELIVERY_ZONE_LIMITS.city) return { ok: false, field: 'city', error: `Nom de ville trop long (${DELIVERY_ZONE_LIMITS.city} caractères au maximum).` };
    city = cityRaw;
  }

  const fee = parseFee(raw.fee_amount);
  if (!Number.isFinite(fee) || fee < 0) return { ok: false, field: 'fee_amount', error: 'Indiquez un supplément valide (0 ou plus).' };
  if (fee > DELIVERY_ZONE_LIMITS.fee) return { ok: false, field: 'fee_amount', error: 'Supplément trop élevé.' };

  const note = cleanText(raw.note);
  if (note.length > DELIVERY_ZONE_LIMITS.note) return { ok: false, field: 'note', error: `Note trop longue (${DELIVERY_ZONE_LIMITS.note} caractères au maximum).` };

  return {
    ok: true,
    kind,
    zone: {
      label,
      country,
      postal_code_prefixes: prefixes,
      city,
      fee_amount: Math.round(fee * 100) / 100,
      note: note || null,
      active: raw.active === undefined ? true : Boolean(raw.active),
    },
  };
}

export interface ExistingDeliveryZone extends ZoneShape {
  id: string;
  label: string;
  country: string | null;
  active: boolean;
}

/**
 * Une adresse ne doit tomber que dans une zone : refuse, parmi les zones
 * actives du même pays, le même début de code postal, la même ville ou une
 * deuxième zone « tout le pays ». Une zone inactive ne bloque rien.
 */
export function findDeliveryZoneConflict(
  zone: NormalizedDeliveryZone,
  others: ReadonlyArray<ExistingDeliveryZone>,
  selfId?: string | null,
): { field: DeliveryZoneField; error: string } | null {
  if (!zone.active) return null;
  const kind = deliveryZoneKind(zone);
  const sameCountry = others.filter((other) => other.id !== selfId && other.active
    && (!other.country || other.country.trim().toUpperCase() === zone.country));

  for (const other of sameCountry) {
    const otherKind = deliveryZoneKind(other);
    if (kind === 'postal' && otherKind === 'postal') {
      const otherPrefixes = new Set(parsePostalPrefixes(other.postal_code_prefixes ?? []));
      const shared = (zone.postal_code_prefixes ?? []).find((prefix) => otherPrefixes.has(prefix));
      if (shared) return { field: 'postal_code_prefixes', error: `« ${shared} » est déjà utilisé par la zone active « ${other.label} ».` };
    }
    if (kind === 'city' && otherKind === 'city' && normalizeZoneCity(other.city ?? '') === normalizeZoneCity(zone.city ?? '')) {
      return { field: 'city', error: `Cette ville est déjà utilisée par la zone active « ${other.label} ».` };
    }
    if (kind === 'country' && otherKind === 'country') {
      return { field: 'kind', error: `La zone active « ${other.label} » couvre déjà tout le pays.` };
    }
  }
  return null;
}

export type NormalizeDeliveryCountriesResult =
  | { ok: true; countries: string[] }
  | { ok: false; error: string };

/** Pays de livraison du tenant : codes ISO2 valides, en majuscules, sans doublons. */
export function normalizeDeliveryCountries(value: unknown): NormalizeDeliveryCountriesResult {
  if (!Array.isArray(value)) return { ok: false, error: 'Liste de pays invalide.' };
  const countries: string[] = [];
  for (const entry of value) {
    const code = typeof entry === 'string' ? entry.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(code)) return { ok: false, error: `Code pays invalide : « ${String(entry ?? '').trim()} ».` };
    if (!countries.includes(code)) countries.push(code);
  }
  if (countries.length > DELIVERY_ZONE_LIMITS.countries) return { ok: false, error: 'Trop de pays.' };
  return { ok: true, countries };
}

/** Début de code postal qui a fait choisir la zone (le plus long), pour l'expliquer. */
export function matchedPostalPrefix(zone: ZoneShape, postalCode: string): string | null {
  const postal = postalCode.replace(/\s+/g, '').toUpperCase();
  const prefixes = parsePostalPrefixes(zone.postal_code_prefixes ?? []).filter((prefix) => postal.startsWith(prefix));
  return prefixes.sort((a, b) => b.length - a.length)[0] ?? null;
}
