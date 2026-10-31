/**
 * Pays : bandeau SVG en couleur, nom dans la langue de l'interface, indicatif
 * téléphonique. Une seule source pour CountrySelect et InternationalPhoneField.
 * Fonctions pures (aucun import React) ; les SVG sont servis depuis /flags
 * (copie de `country-flag-icons`, jamais un rendu emoji).
 */
import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js';

export function isIsoCountry(code: string | null | undefined): code is string {
  return typeof code === 'string' && /^[A-Za-z]{2}$/.test(code);
}

/** Chemin du drapeau SVG en couleur d'un pays ISO2 (casse libre). */
export function flagSrc(code: string): string {
  return `/flags/${code.trim().toLowerCase()}.svg`;
}

const nameCache = new Map<string, Intl.DisplayNames | null>();

/** Nom du pays dans la langue demandée (français par défaut) ; le code si inconnu. */
export function countryDisplayName(code: string, locale = 'fr'): string {
  const upper = code.trim().toUpperCase();
  let names = nameCache.get(locale);
  if (names === undefined) {
    try { names = new Intl.DisplayNames([locale], { type: 'region' }); } catch { names = null; }
    nameCache.set(locale, names);
  }
  try {
    const name = names?.of(upper);
    return name && name !== upper ? name : upper;
  } catch {
    return upper;
  }
}

export interface CountryEntry { code: string; name: string }

function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Filtre « par nom, code ISO ou indicatif » (accents et casse ignorés). */
export function filterCountries<T extends CountryEntry>(entries: ReadonlyArray<T>, query: string, withDialCode = false): T[] {
  const q = normalizeForSearch(query).replace(/^\+/, '');
  if (!q) return [...entries];
  const digits = /^\d+$/.test(q);
  return entries.filter((entry) => {
    if (withDialCode && digits && dialCode(entry.code)?.startsWith(q)) return true;
    return normalizeForSearch(entry.name).includes(q) || (q.length === 2 && entry.code.toLowerCase() === q);
  });
}

/** Indicatif sans « + » (« 39 »), ou null si le pays n'a pas de plan de numérotation connu. */
export function dialCode(code: string): string | null {
  try { return getCountryCallingCode(code.trim().toUpperCase() as CountryCode); } catch { return null; }
}

/** Tous les pays téléphoniques connus, triés par nom ; les `priority` d'abord, dans l'ordre donné. */
export function phoneCountries(locale = 'fr', priority: ReadonlyArray<string> = []): CountryEntry[] {
  const all = getCountries().map((code) => ({ code: code as string, name: countryDisplayName(code, locale) }));
  all.sort((a, b) => a.name.localeCompare(b.name, locale));
  const top = priority.map((code) => all.find((entry) => entry.code === code.toUpperCase())).filter((entry): entry is CountryEntry => Boolean(entry));
  return [...top, ...all.filter((entry) => !top.includes(entry))];
}
