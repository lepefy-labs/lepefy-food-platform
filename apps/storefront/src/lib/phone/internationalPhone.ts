/**
 * Téléphone international : analyse, validation par pays et normalisation
 * E.164. Fonctions pures, partagées par InternationalPhoneField (navigateur)
 * et les routes de commande (serveur).
 *
 * Un numéro déjà enregistré dans un autre format (« 351 234 5678 », « 0033 6… »)
 * reste lisible : `parseStoredPhone` ne le rejette jamais, il le reconnaît
 * seulement quand il est valide.
 */
import { AsYouType, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export interface ParsedPhone {
  /** Pays du préfixe (ISO2) ; celui par défaut si le numéro n'a pas pu être lu. */
  country: string;
  /** Partie nationale telle qu'affichée dans le champ (formatée). */
  national: string;
  /** E.164 (+393512345678) si le numéro est valide, sinon null. */
  e164: string | null;
}

const asCountry = (code: string) => code.trim().toUpperCase() as CountryCode;

/** Lit un numéro enregistré ou collé (avec « + » ou « 00 » ⇒ international, sinon pays par défaut). */
export function parseStoredPhone(raw: string | null | undefined, defaultCountry: string): ParsedPhone {
  const text = (raw ?? '').trim();
  if (!text) return { country: defaultCountry.toUpperCase(), national: '', e164: null };
  const international = text.replace(/^00(?=\d)/, '+');
  const parsed = parsePhoneNumberFromString(international, asCountry(defaultCountry));
  if (parsed && parsed.country) {
    return {
      country: parsed.country,
      national: parsed.formatNational(),
      e164: parsed.isValid() ? parsed.number : null,
    };
  }
  return { country: defaultCountry.toUpperCase(), national: text, e164: null };
}

/** Numéro national saisi + pays du préfixe → E.164, ou null si invalide pour ce pays. */
export function toE164Phone(national: string, country: string): string | null {
  const text = national.trim();
  if (!text) return null;
  const parsed = parsePhoneNumberFromString(text.startsWith('+') ? text : text.replace(/^00(?=\d)/, '+'), asCountry(country));
  return parsed && parsed.isValid() ? parsed.number : null;
}

/** Formatage progressif de la partie nationale pendant la saisie. */
export function formatNationalLive(national: string, country: string): string {
  if (!national) return national;
  return new AsYouType(asCountry(country)).input(national);
}

/**
 * Numéro collé avec un « + » (ou « 00 ») : le pays du préfixe remplace celui
 * choisi. Retourne null quand ce n'est pas un numéro international lisible.
 */
export function readPastedInternational(pasted: string): { country: string; national: string } | null {
  const text = pasted.trim();
  if (!/^(\+|00)\s*\d/.test(text)) return null;
  const parsed = parsePhoneNumberFromString(text.replace(/^00(?=\d)/, '+'));
  if (!parsed || !parsed.country) return null;
  return { country: parsed.country, national: parsed.formatNational() };
}

/**
 * Valeur à enregistrer pour un téléphone reçu du navigateur : E.164 quand il
 * est valide, sinon le texte nettoyé (comptes déjà enregistrés, ancien format).
 * `valid` dit si la validation stricte a réussi.
 */
export function normalizePhoneForStorage(raw: unknown, defaultCountry: string): { value: string | null; e164: string | null } {
  if (typeof raw !== 'string') return { value: null, e164: null };
  const text = raw.trim().slice(0, 40);
  if (!text) return { value: null, e164: null };
  const parsed = parseStoredPhone(text, defaultCountry);
  return { value: parsed.e164 ?? text, e164: parsed.e164 };
}

/** Chiffres uniquement : au moins 6 pour qu'un numéro soit exploitable (même règle que le brouillon d'expédition). */
export function hasUsableDigits(phone: string | null | undefined): boolean {
  return (phone ?? '').replace(/\D/g, '').length >= 6;
}
