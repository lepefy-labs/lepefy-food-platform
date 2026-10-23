/**
 * Pays de l'estimation du forfait au panier, avant toute adresse — pur.
 *
 * Ordre (décision produit) : adresse déjà connue (saisie au checkout dans la
 * session, ou choix explicite du client) → adresse par défaut du client
 * connecté → pays de l'IP s'il a un forfait actif → pays par défaut de la
 * boutique. Un pays sans forfait actif n'est jamais retenu : pas d'estimation
 * plutôt qu'un prix faux. L'IP n'est qu'un indice (diaspora) : elle choisit
 * parmi les pays servis, elle ne masque jamais l'estimation.
 */

export type EstimateCountrySource = 'address' | 'chosen' | 'account' | 'ip' | 'default';

export interface EstimateCountryInput {
  activeCountries: ReadonlyArray<string>;
  /** Adresse saisie au checkout dans cette session (pays + CP). */
  address?: { country: string; postalCode: string | null } | null;
  /** Pays choisi par le client dans « Changer » (sans CP). */
  chosenCountry?: string | null;
  account?: { country: string; postalCode: string | null } | null;
  ipCountry?: string | null;
  defaultCountry?: string | null;
}

export interface EstimateCountry {
  country: string;
  postalCode: string | null;
  source: EstimateCountrySource;
}

const upper = (value: string | null | undefined) => value?.trim().toUpperCase() || null;

export function chooseEstimateCountry(input: EstimateCountryInput): EstimateCountry | null {
  const active = new Set(input.activeCountries.map((code) => code.toUpperCase()));
  const served = (code: string | null) => (code && active.has(code) ? code : null);
  const candidates: Array<{ country: string | null; postalCode: string | null; source: EstimateCountrySource }> = [
    { country: upper(input.address?.country), postalCode: input.address?.postalCode ?? null, source: 'address' },
    { country: upper(input.chosenCountry), postalCode: null, source: 'chosen' },
    { country: upper(input.account?.country), postalCode: input.account?.postalCode ?? null, source: 'account' },
    { country: upper(input.ipCountry), postalCode: null, source: 'ip' },
    { country: upper(input.defaultCountry), postalCode: null, source: 'default' },
  ];
  for (const candidate of candidates) {
    const country = served(candidate.country);
    if (country) return { country, postalCode: candidate.postalCode?.trim() || null, source: candidate.source };
  }
  return null;
}
