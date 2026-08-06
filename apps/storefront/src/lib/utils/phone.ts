import { AsYouType, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

// Formatage progressif pendant la saisie (onChange) — AsYouType réinterprète
// toute la chaîne à chaque frappe, aucun état de formatage à maintenir côté
// composant appelant.
export function formatPhoneLive(raw: string, defaultCountry: CountryCode): string {
  if (!raw) return raw;
  return new AsYouType(defaultCountry).input(raw);
}

// Numéro E.164 (ex. +393880945556) prêt pour l'API, ou null si invalide pour
// le plan de numérotation de defaultCountry (ou pour le pays saisi en
// international, ex. "+33 6...").
export function toE164(raw: string, defaultCountry: CountryCode): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const phoneNumber = parsePhoneNumberFromString(trimmed, defaultCountry);
  return phoneNumber && phoneNumber.isValid() ? phoneNumber.number : null;
}
