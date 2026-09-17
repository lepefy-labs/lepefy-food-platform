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
 *   préfixe CP le plus long > ville exacte > ligne pays seul (wildcard CP/ville)
 */

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
  const country = address.country.toUpperCase();
  const city = address.city.trim().toLowerCase();
  const postalCode = address.postal_code.trim();

  const inCountry = zones.filter((zone) => !zone.country || zone.country.toUpperCase() === country);
  if (inCountry.length === 0) return null;

  // 1. Préfixe CP le plus long qui matche réellement le CP fourni.
  let bestPrefixMatch: T | null = null;
  let bestPrefixLength = -1;
  for (const zone of inCountry) {
    for (const prefix of zone.postal_code_prefixes ?? []) {
      if (prefix && postalCode.startsWith(prefix) && prefix.length > bestPrefixLength) {
        bestPrefixMatch = zone;
        bestPrefixLength = prefix.length;
      }
    }
  }
  if (bestPrefixMatch) return bestPrefixMatch;

  // 2. Ville exacte (sur une zone qui ne définit pas de préfixe CP).
  const cityMatch = inCountry.find(
    (zone) => (!zone.postal_code_prefixes || zone.postal_code_prefixes.length === 0)
      && zone.city && zone.city.trim().toLowerCase() === city,
  );
  if (cityMatch) return cityMatch;

  // 3. Ligne pays seul — wildcard sur CP et ville.
  const countryOnlyMatch = inCountry.find(
    (zone) => (!zone.postal_code_prefixes || zone.postal_code_prefixes.length === 0) && !zone.city,
  );
  return countryOnlyMatch ?? null;
}
