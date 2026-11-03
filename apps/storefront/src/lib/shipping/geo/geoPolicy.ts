/**
 * Politique géographique de livraison d'un tenant (fonctions pures).
 *
 *  - Destinations : `current` (pays configurés aujourd'hui), `eu`, `carrier_all`
 *    (tous les pays que le transporteur peut desservir — la disponibilité réelle
 *    est vérifiée par le devis provider), `custom`; plus des exclusions.
 *  - Conservation : par `products.storage_type` (dry | fresh | frozen), jamais
 *    d'autre critère. « none » = Lepefy n'ajoute aucune restriction; ce n'est
 *    pas une garantie de transport ni une dispense douanière.
 *
 * Pas d'alias `@/` ni de dépendance serveur: partagé navigateur/serveur/tests.
 */

export const EU_COUNTRIES: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];

/** Pays proposés avant cette fonctionnalité (checkout, compte). */
export const LEGACY_DELIVERY_COUNTRIES: readonly string[] = ['IT', 'FR', 'BE', 'DE', 'CH'];

export type DestinationMode = 'current' | 'eu' | 'carrier_all' | 'custom';
export type StorageType = 'dry' | 'fresh' | 'frozen';
export type StorageRestrictionMode = 'none' | 'store_country' | 'eu' | 'custom';

export const STORAGE_TYPES: readonly StorageType[] = ['dry', 'fresh', 'frozen'];
export const STORAGE_LABELS: Record<StorageType, string> = {
  dry: 'Ambiant',
  fresh: 'Frais / Réfrigéré',
  frozen: 'Surgelé',
};

export interface StorageRule { mode: StorageRestrictionMode; countries: string[] }

export interface GeoPolicy {
  destinationMode: DestinationMode;
  includedCountries: string[];
  excludedCountries: string[];
  providerFallbackEnabled: boolean;
  storageRules: Record<StorageType, StorageRule>;
  /** 0 = aucune ligne en base (politique implicite neutre). */
  version: number;
}

export const NEUTRAL_STORAGE_RULES: Record<StorageType, StorageRule> = {
  dry: { mode: 'none', countries: [] },
  fresh: { mode: 'none', countries: [] },
  frozen: { mode: 'none', countries: [] },
};

export function defaultGeoPolicy(): GeoPolicy {
  return {
    destinationMode: 'current',
    includedCountries: [],
    excludedCountries: [],
    providerFallbackEnabled: false,
    storageRules: structuredClone(NEUTRAL_STORAGE_RULES),
    version: 0,
  };
}

const ISO2 = /^[A-Z]{2}$/;

export function normalizeCountryList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    const code = entry.trim().toUpperCase();
    if (!ISO2.test(code)) return null;
    if (!out.includes(code)) out.push(code);
  }
  return out.length <= 300 ? out.sort() : null;
}

/** Ligne DB → politique (valeurs inconnues ou corrompues → neutre, jamais plus permissif). */
export function geoPolicyFromRow(row: {
  destination_mode?: unknown; included_countries?: unknown; excluded_countries?: unknown;
  provider_fallback_enabled?: unknown; storage_rules?: unknown; policy_version?: unknown;
} | null | undefined): GeoPolicy {
  if (!row) return defaultGeoPolicy();
  const mode = row.destination_mode;
  const destinationMode: DestinationMode = mode === 'eu' || mode === 'carrier_all' || mode === 'custom' ? mode : 'current';
  const rules = structuredClone(NEUTRAL_STORAGE_RULES);
  const raw = (row.storage_rules && typeof row.storage_rules === 'object' ? row.storage_rules : {}) as Record<string, { mode?: unknown; countries?: unknown }>;
  for (const type of STORAGE_TYPES) {
    const entry = raw[type];
    if (!entry) continue;
    const countries = normalizeCountryList(entry.countries ?? []) ?? [];
    if (entry.mode === 'store_country' || entry.mode === 'eu' || entry.mode === 'none') rules[type] = { mode: entry.mode, countries: [] };
    // Liste personnalisée corrompue/vide: refus de tout plutôt qu'ouverture.
    else if (entry.mode === 'custom') rules[type] = { mode: 'custom', countries };
  }
  return {
    destinationMode,
    includedCountries: normalizeCountryList(row.included_countries ?? []) ?? [],
    excludedCountries: normalizeCountryList(row.excluded_countries ?? []) ?? [],
    providerFallbackEnabled: row.provider_fallback_enabled === true,
    storageRules: rules,
    version: typeof row.policy_version === 'number' && Number.isInteger(row.policy_version) ? row.policy_version : 0,
  };
}

export type GeoPolicyInputResult = { ok: true; value: Omit<GeoPolicy, 'version'> } | { ok: false; error: string };

/** Validation d'une écriture admin. */
export function parseGeoPolicyInput(body: unknown): GeoPolicyInputResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Requête invalide.' };
  const b = body as Record<string, unknown>;
  const mode = b.destinationMode;
  if (mode !== 'current' && mode !== 'eu' && mode !== 'carrier_all' && mode !== 'custom') {
    return { ok: false, error: 'Mode de destinations invalide.' };
  }
  const included = normalizeCountryList(b.includedCountries ?? []);
  const excluded = normalizeCountryList(b.excludedCountries ?? []);
  if (!included || !excluded) return { ok: false, error: 'Liste de pays invalide.' };
  if (mode === 'custom' && included.length === 0) return { ok: false, error: 'Sélectionnez au moins un pays pour la liste personnalisée.' };
  if (typeof b.providerFallbackEnabled !== 'boolean') return { ok: false, error: 'Valeur de repli invalide.' };
  const rawRules = (b.storageRules && typeof b.storageRules === 'object' ? b.storageRules : null) as Record<string, { mode?: unknown; countries?: unknown }> | null;
  if (!rawRules) return { ok: false, error: 'Règles de conservation manquantes.' };
  const storageRules = structuredClone(NEUTRAL_STORAGE_RULES);
  for (const type of STORAGE_TYPES) {
    const entry = rawRules[type];
    if (!entry) return { ok: false, error: `Règle manquante : ${STORAGE_LABELS[type]}.` };
    if (entry.mode !== 'none' && entry.mode !== 'store_country' && entry.mode !== 'eu' && entry.mode !== 'custom') {
      return { ok: false, error: `Règle invalide : ${STORAGE_LABELS[type]}.` };
    }
    const countries = normalizeCountryList(entry.countries ?? []);
    if (!countries) return { ok: false, error: `Pays invalides : ${STORAGE_LABELS[type]}.` };
    if (entry.mode === 'custom' && countries.length === 0) {
      return { ok: false, error: `${STORAGE_LABELS[type]} : sélectionnez au moins un pays.` };
    }
    storageRules[type] = { mode: entry.mode, countries: entry.mode === 'custom' ? countries : [] };
  }
  return {
    ok: true,
    value: {
      destinationMode: mode,
      includedCountries: mode === 'custom' ? included : [],
      excludedCountries: excluded,
      providerFallbackEnabled: b.providerFallbackEnabled,
      storageRules,
    },
  };
}

// ─── Destinations ───────────────────────────────────────────────────────────

export type DestinationDecision =
  | { allowed: true }
  | { allowed: false; reason: 'excluded' | 'not_in_policy' | 'invalid_country' };

/**
 * `configuredCountries` = pays configurés aujourd'hui (forfaits actifs + liste
 * historique), utilisé par le mode `current`. Sélectionnable ≠ acquistable: le
 * devis provider reste l'autorité pour `carrier_all`.
 */
export function isDestinationAllowed(
  policy: Pick<GeoPolicy, 'destinationMode' | 'includedCountries' | 'excludedCountries'>,
  country: string,
  configuredCountries: ReadonlyArray<string>,
): DestinationDecision {
  const code = country.trim().toUpperCase();
  if (!ISO2.test(code)) return { allowed: false, reason: 'invalid_country' };
  if (policy.excludedCountries.includes(code)) return { allowed: false, reason: 'excluded' };
  const inScope = policy.destinationMode === 'carrier_all'
    || (policy.destinationMode === 'eu' && EU_COUNTRIES.includes(code))
    || (policy.destinationMode === 'custom' && policy.includedCountries.includes(code))
    || (policy.destinationMode === 'current' && (LEGACY_DELIVERY_COUNTRIES.includes(code) || configuredCountries.includes(code)));
  return inScope ? { allowed: true } : { allowed: false, reason: 'not_in_policy' };
}

/** Pays proposables au client (codes ISO2), hors `carrier_all` (liste = catalogue entier). */
export function destinationCountryList(
  policy: Pick<GeoPolicy, 'destinationMode' | 'includedCountries' | 'excludedCountries'>,
  configuredCountries: ReadonlyArray<string>,
  catalog: ReadonlyArray<string>,
): string[] {
  return catalog.filter((c) => isDestinationAllowed(policy, c, configuredCountries).allowed);
}

// ─── Conservation ───────────────────────────────────────────────────────────

export function resolveStorageType(value: unknown): StorageType | null {
  return value === 'dry' || value === 'fresh' || value === 'frozen' ? value : null;
}

export function storageRuleAllows(rule: StorageRule, country: string, storeCountry: string | null | undefined): boolean {
  const code = country.trim().toUpperCase();
  switch (rule.mode) {
    case 'none': return true;
    case 'eu': return EU_COUNTRIES.includes(code);
    case 'store_country': return Boolean(storeCountry) && storeCountry!.trim().toUpperCase() === code;
    case 'custom': return rule.countries.includes(code);
    default: return false;
  }
}

export interface CartProductStorage { id: string; name: string; storageType: unknown }

export type StorageEvaluation =
  | { ok: true }
  | { ok: false; blocked: Array<{ id: string; name: string; storageType: StorageType | null }> };

/**
 * Un produit sans classement reconnaissable (valeur absente/inconnue) est
 * bloqué dès que la moindre restriction de conservation existe pour ce pays:
 * jamais présumé non périssable.
 */
export function evaluateStorageRestrictions(
  policy: Pick<GeoPolicy, 'storageRules'>,
  country: string,
  storeCountry: string | null | undefined,
  products: ReadonlyArray<CartProductStorage>,
): StorageEvaluation {
  const anyRestriction = STORAGE_TYPES.some((t) => policy.storageRules[t].mode !== 'none');
  const blocked: Array<{ id: string; name: string; storageType: StorageType | null }> = [];
  for (const product of products) {
    const type = resolveStorageType(product.storageType);
    if (!type) {
      if (anyRestriction) blocked.push({ id: product.id, name: product.name, storageType: null });
      continue;
    }
    if (!storageRuleAllows(policy.storageRules[type], country, storeCountry)) blocked.push({ id: product.id, name: product.name, storageType: type });
  }
  return blocked.length === 0 ? { ok: true } : { ok: false, blocked };
}

export const STORAGE_BLOCKED_MESSAGE = 'Certains produits de votre panier ne peuvent pas être livrés dans ce pays.';
export const DESTINATION_BLOCKED_MESSAGE = 'La livraison n’est pas proposée vers ce pays.';

/** Empreinte signée dans le devis: toute écriture de la politique invalide les devis ouverts. */
export function geoPolicyStamp(policy: Pick<GeoPolicy, 'version'>): string {
  return `g${policy.version}`;
}
