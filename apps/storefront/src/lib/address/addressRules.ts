/**
 * Règles d'adresse de livraison, partagées par le navigateur (formulaire
 * client) et le serveur (API compte et checkout). Fonctions pures, imports
 * relatifs uniquement.
 *
 * Une adresse compilée n'est jamais une adresse « livrable » : la livraison
 * est décidée uniquement par le devis (/api/shipping/quote).
 */

import { ADDRESS_COPY, postalCodeFormatMessage } from '../storefrontCopy/addressCopy';

/** Pays proposés au client (même liste partout : checkout, compte, reprise). */
export const DELIVERY_COUNTRIES = [
  { code: 'IT', label: 'Italie' },
  { code: 'FR', label: 'France' },
  { code: 'BE', label: 'Belgique' },
  { code: 'DE', label: 'Allemagne' },
  { code: 'CH', label: 'Suisse' },
] as const;

export type DeliveryCountryCode = (typeof DELIVERY_COUNTRIES)[number]['code'];

export function isDeliveryCountry(code: string | null | undefined): code is DeliveryCountryCode {
  return DELIVERY_COUNTRIES.some((entry) => entry.code === code);
}

export function countryLabel(code: string): string {
  return DELIVERY_COUNTRIES.find((entry) => entry.code === code)?.label ?? code;
}

/** Pays de la boutique s'il est livré, sinon le premier de la liste. */
export function defaultDeliveryCountry(preferred?: string | null): DeliveryCountryCode {
  const upper = preferred?.trim().toUpperCase();
  return isDeliveryCountry(upper) ? upper : DELIVERY_COUNTRIES[0].code;
}

interface CountryAddressRule {
  postalDigits: number;
  example: { street: string; houseNumber: string; postalCode: string; city: string };
}

/** Formats postaux et exemples réalistes par pays. */
export const COUNTRY_ADDRESS_RULES: Record<DeliveryCountryCode, CountryAddressRule> = {
  IT: { postalDigits: 5, example: { street: 'Via Roma', houseNumber: '25', postalCode: '42121', city: 'Reggio Emilia' } },
  FR: { postalDigits: 5, example: { street: 'Rue de la Roquette', houseNumber: '12', postalCode: '75011', city: 'Paris' } },
  BE: { postalDigits: 4, example: { street: 'Rue Neuve', houseNumber: '25', postalCode: '1000', city: 'Bruxelles' } },
  DE: { postalDigits: 5, example: { street: 'Invalidenstraße', houseNumber: '25', postalCode: '10115', city: 'Berlin' } },
  CH: { postalDigits: 4, example: { street: 'Rue de Lausanne', houseNumber: '25', postalCode: '1201', city: 'Genève' } },
};

export function addressExample(country: string): CountryAddressRule['example'] {
  return isDeliveryCountry(country) ? COUNTRY_ADDRESS_RULES[country].example : COUNTRY_ADDRESS_RULES.IT.example;
}

/** Limites de longueur (rue 2 = limite street2 de Packlink). */
export const ADDRESS_LIMITS = {
  fullName: 120,
  line1: 200,
  line2: 120,
  city: 100,
  postalCode: 12,
} as const;

/** Valeur enregistrée pour une adresse sans numéro (déjà lue par splitLine1). */
export const NO_HOUSE_NUMBER = 's.n.';

/** Même forme que le serveur et le jeton de devis : majuscules, espaces simples. */
export function normalizePostalCode(country: string, value: string): string {
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, ' ');
  // Codes purement numériques (tous les pays proposés) : aucun espace.
  return isDeliveryCountry(country) ? cleaned.replace(/\s/g, '') : cleaned;
}

export function isValidPostalCode(country: string, value: string): boolean {
  const normalized = normalizePostalCode(country, value);
  if (isDeliveryCountry(country)) {
    return new RegExp(`^\\d{${COUNTRY_ADDRESS_RULES[country].postalDigits}}$`).test(normalized);
  }
  return /^[A-Z0-9][A-Z0-9 -]{1,9}$/.test(normalized);
}

export function postalCodeError(country: string): string {
  const digits = isDeliveryCountry(country) ? COUNTRY_ADDRESS_RULES[country].postalDigits : null;
  return postalCodeFormatMessage(countryLabel(country), digits, addressExample(country).postalCode);
}

/** « Via Roma 25 » → rue + numéro (numéro = dernier mot s'il contient un chiffre, ou « s.n. »). */
export function splitLine1(line1: string): { street: string; houseNumber: string } {
  const parts = line1.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { street: line1.trim(), houseNumber: '' };
  const last = parts[parts.length - 1] ?? '';
  if (/\d/.test(last) || /^s\.?\s?n\.?$/i.test(last)) {
    return { street: parts.slice(0, -1).join(' '), houseNumber: last };
  }
  return { street: parts.join(' '), houseNumber: '' };
}

export function composeLine1(street: string, houseNumber: string): string {
  return `${collapse(street)} ${collapse(houseNumber)}`.trim();
}

export function isNoHouseNumber(value: string): boolean {
  return /^s\.?\s?n\.?$/i.test(value.trim());
}

/** Adresse saisie dans le formulaire client (une valeur par champ). */
export interface AddressDraft {
  country: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  line2: string;
  /** Présent seulement quand le formulaire demande le destinataire (/compte). */
  fullName?: string;
}

export type AddressField = 'fullName' | 'country' | 'street' | 'houseNumber' | 'postalCode' | 'city' | 'line2';

/** Ordre d'affichage, utilisé pour le focus et le résumé des erreurs. */
export const ADDRESS_FIELD_ORDER: AddressField[] = ['fullName', 'country', 'street', 'houseNumber', 'postalCode', 'city', 'line2'];

export const ADDRESS_FIELD_LABELS: Record<AddressField, string> = {
  fullName: ADDRESS_COPY.fullName,
  country: ADDRESS_COPY.country,
  street: ADDRESS_COPY.street,
  houseNumber: ADDRESS_COPY.houseNumber,
  postalCode: ADDRESS_COPY.postalCode,
  city: ADDRESS_COPY.city,
  line2: ADDRESS_COPY.line2,
};

export function emptyAddressDraft(country: string): AddressDraft {
  return { country, street: '', houseNumber: '', postalCode: '', city: '', line2: '' };
}

export type AddressErrors = Partial<Record<AddressField, string>>;

/** Erreurs champ par champ ; objet vide = adresse complète (pas « livrable »). */
export function validateAddressDraft(draft: AddressDraft, options: { requireFullName?: boolean } = {}): AddressErrors {
  const errors: AddressErrors = {};
  if (options.requireFullName) {
    const name = collapse(draft.fullName ?? '');
    if (!name) errors.fullName = ADDRESS_COPY.required;
    else if (name.length > ADDRESS_LIMITS.fullName) errors.fullName = ADDRESS_COPY.tooLong;
  }
  if (!isDeliveryCountry(draft.country)) errors.country = ADDRESS_COPY.countryUnsupported;
  if (!collapse(draft.street)) errors.street = ADDRESS_COPY.required;
  if (!collapse(draft.houseNumber)) errors.houseNumber = ADDRESS_COPY.houseNumberRequired;
  if (!errors.street && !errors.houseNumber && composeLine1(draft.street, draft.houseNumber).length > ADDRESS_LIMITS.line1) {
    errors.street = ADDRESS_COPY.tooLong;
  }
  if (!draft.postalCode.trim()) errors.postalCode = ADDRESS_COPY.required;
  else if (!isValidPostalCode(draft.country, draft.postalCode)) errors.postalCode = postalCodeError(draft.country);
  if (!collapse(draft.city)) errors.city = ADDRESS_COPY.required;
  else if (collapse(draft.city).length > ADDRESS_LIMITS.city) errors.city = ADDRESS_COPY.tooLong;
  if (collapse(draft.line2).length > ADDRESS_LIMITS.line2) errors.line2 = ADDRESS_COPY.tooLong;
  return errors;
}

export function firstErrorField(errors: AddressErrors): AddressField | null {
  return ADDRESS_FIELD_ORDER.find((field) => errors[field]) ?? null;
}

/** Forme stockée (checkout_sessions / orders.shipping_address, addresses). */
export interface NormalizedShippingAddress {
  full_name: string;
  line1: string;
  line2?: string;
  city: string;
  postal_code: string;
  country: string;
}

export function draftToShippingAddress(draft: AddressDraft, fullName: string): NormalizedShippingAddress {
  const line2 = collapse(draft.line2);
  return {
    full_name: collapse(fullName),
    line1: composeLine1(draft.street, draft.houseNumber),
    ...(line2 ? { line2 } : {}),
    city: collapse(draft.city),
    postal_code: normalizePostalCode(draft.country, draft.postalCode),
    country: draft.country.trim().toUpperCase(),
  };
}

export function shippingAddressToDraft(address: {
  line1: string; line2?: string | null; city: string; postal_code: string; country: string; full_name?: string | null;
}): AddressDraft {
  const { street, houseNumber } = splitLine1(address.line1);
  return {
    country: address.country,
    street,
    houseNumber,
    postalCode: address.postal_code,
    city: address.city,
    line2: address.line2 ?? '',
    fullName: address.full_name ?? undefined,
  };
}

export type NormalizeShippingAddressResult =
  | { ok: true; address: NormalizedShippingAddress }
  | { ok: false; field: string; error: string };

/**
 * Contrôle serveur d'une adresse reçue du navigateur : seuls les champs
 * connus sont conservés (jamais d'autres clés JSON), texte nettoyé, longueurs
 * bornées. Ne dit rien de la livraison : le devis reste l'autorité.
 */
export function normalizeShippingAddress(value: unknown): NormalizeShippingAddressResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, field: 'address', error: 'Écrivez votre adresse de livraison.' };
  }
  const raw = value as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === 'string' ? collapse(stripControl(raw[key] as string)) : '');

  const fullName = text('full_name');
  const line1 = text('line1');
  const line2 = text('line2');
  const city = text('city');
  const country = text('country').toUpperCase();
  const postalCode = normalizePostalCode(country, text('postal_code'));

  const missing = (field: string, label: string) => ({ ok: false as const, field, error: `${label} : ${ADDRESS_COPY.required.toLowerCase()}` });
  if (!fullName) return missing('full_name', ADDRESS_COPY.fullName);
  if (!line1) return missing('line1', ADDRESS_COPY.street);
  if (!postalCode) return missing('postal_code', ADDRESS_COPY.postalCode);
  if (!city) return missing('city', ADDRESS_COPY.city);
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, field: 'country', error: ADDRESS_COPY.countryUnsupported };

  const tooLong = (field: string, label: string) => ({ ok: false as const, field, error: `${label} : ${ADDRESS_COPY.tooLong.toLowerCase()}` });
  if (fullName.length > ADDRESS_LIMITS.fullName) return tooLong('full_name', ADDRESS_COPY.fullName);
  if (line1.length > ADDRESS_LIMITS.line1) return tooLong('line1', ADDRESS_COPY.street);
  if (line2.length > ADDRESS_LIMITS.line2) return tooLong('line2', ADDRESS_COPY.line2);
  if (city.length > ADDRESS_LIMITS.city) return tooLong('city', ADDRESS_COPY.city);
  if (!isValidPostalCode(country, postalCode)) return { ok: false, field: 'postal_code', error: postalCodeError(country) };

  return {
    ok: true,
    address: { full_name: fullName, line1, ...(line2 ? { line2 } : {}), city, postal_code: postalCode, country },
  };
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function stripControl(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ');
}
