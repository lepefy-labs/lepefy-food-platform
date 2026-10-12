/**
 * matchDeliveryZone.ts
 *
 * Fonctions pures partagées entre la route de devis publique
 * (/api/rental/delivery-quote), les deux routes de checkout location
 * (/api/rental/checkout, /api/rental/checkout-external-link) et les actions
 * admin (conversion pickup→delivery, évaluation manuelle du supplément) —
 * une seule source de vérité pour le matching de zone.
 *
 * Deux niveaux de contrôle distincts :
 *   1. isCountryAllowedForDelivery() — macro-zone : le tenant active la
 *      livraison pour une liste de pays. Si le pays n'y est pas, la livraison
 *      n'est simplement pas proposée pour cette adresse.
 *   2. matchDeliveryZone() — zone précise (préfixe CP / ville / pays) avec un
 *      montant fixe, appliqué automatiquement si elle matche. Si le pays est
 *      autorisé mais qu'aucune zone ne matche, le supplément reste "à évaluer"
 *      par l'admin (rental_reservations.delivery_fee_status = 'pending_quote').
 *
 * Précédence de matching (la plus spécifique gagne) :
 *   préfixe CP le plus long > même ville > ligne pays seul (wildcard CP/ville)
 *
 * « Même ville » = même nom après normalizeZoneCity() : casse, accents,
 * ponctuation et petits mots de liaison ignorés (« Reggio nell'Emilia » =
 * « Reggio Emilia », « Saint-Étienne » = « saint etienne »). Le nom entier doit
 * rester identique : jamais de ressemblance approximative entre deux villes.
 * Les CP sont comparés sans espaces et en majuscules des deux côtés.
 */

/** Petits mots de liaison (IT/FR/DE) ignorés dans les noms de ville. */
const CITY_CONNECTORS = new Set([
  // italien
  'di', 'd', 'da', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'dell',
  'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'nell', 'in',
  'sul', 'sullo', 'sulla', 'sull', 'al', 'allo', 'alla', 'all', 'a', 'e',
  'il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'con',
  // français
  'de', 'du', 'des', 'les', 'sur', 'sous', 'en', 'aux', 'au', 'et',
  // allemand
  'am', 'an', 'im', 'bei', 'ob', 'auf', 'der', 'die', 'das', 'den', 'dem', 'und',
]);

/**
 * Clé de comparaison d'un nom de ville : minuscules, sans accents, apostrophes
 * tirets et points remplacés par des espaces, mots de liaison retirés. Un nom
 * fait uniquement de mots de liaison garde tous ses mots.
 */
export function normalizeZoneCity(value: string): string {
  const words = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`´\-‐‑–—.,/()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = words.filter((word) => !CITY_CONNECTORS.has(word));
  return (meaningful.length > 0 ? meaningful : words).join(' ');
}

/** CP comparable : sans espaces, en majuscules. */
function comparablePostalCode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export interface DeliveryTenantConfig {
  rental_delivery_enabled: boolean;
  rental_delivery_countries: string[] | null;
}

export interface DeliveryZoneCandidate {
  id: string;
  postal_code_prefixes: string[] | null;
  city: string | null;
  country: string | null;
  fee_amount: number;
}

export interface DeliveryAddressInput {
  country: string;
  postal_code: string;
  city: string;
}

export function isCountryAllowedForDelivery(tenant: DeliveryTenantConfig, country: string): boolean {
  if (!tenant.rental_delivery_enabled) return false;
  const countries = tenant.rental_delivery_countries ?? [];
  if (countries.length === 0) return false;
  return countries.includes(country.toUpperCase());
}

export function matchDeliveryZone<T extends DeliveryZoneCandidate>(
  zones: T[],
  address: DeliveryAddressInput,
): T | null {
  const country = address.country.trim().toUpperCase();
  const city = normalizeZoneCity(address.city);
  const postalCode = comparablePostalCode(address.postal_code);

  const inCountry = zones.filter((zone) => !zone.country || zone.country.trim().toUpperCase() === country);
  if (inCountry.length === 0) return null;

  // 1. Préfixe CP le plus long qui matche réellement le CP fourni.
  let bestPrefixMatch: T | null = null;
  let bestPrefixLength = -1;
  for (const zone of inCountry) {
    for (const rawPrefix of zone.postal_code_prefixes ?? []) {
      const prefix = comparablePostalCode(rawPrefix ?? '');
      if (prefix && postalCode.startsWith(prefix) && prefix.length > bestPrefixLength) {
        bestPrefixMatch = zone;
        bestPrefixLength = prefix.length;
      }
    }
  }
  if (bestPrefixMatch) return bestPrefixMatch;

  // 2. Même ville (sur une zone qui ne définit pas de préfixe CP).
  const cityMatch = city ? inCountry.find(
    (zone) => (!zone.postal_code_prefixes || zone.postal_code_prefixes.length === 0)
      && zone.city && normalizeZoneCity(zone.city) === city,
  ) : undefined;
  if (cityMatch) return cityMatch;

  // 3. Ligne pays seul — wildcard sur CP et ville.
  const countryOnlyMatch = inCountry.find(
    (zone) => (!zone.postal_code_prefixes || zone.postal_code_prefixes.length === 0) && !zone.city,
  );
  return countryOnlyMatch ?? null;
}
