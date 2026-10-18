/**
 * Modification rapide des prix d'une version tarifaire active
 * (Admin → Livraison → Forfait, « Modifier les tarifs »).
 *
 * Pur et client-safe : utilisé par l'éditeur (saisie, champs modifiés, récapitulatif
 * « Ancien prix / Nouveau prix ») ET par l'API de publication, qui reconstruit la
 * version côté serveur. Seuls les montants changent : tranches de poids, blocs,
 * zones, colis, TVA et limite logistique sont toujours recopiés de la version de
 * base (la RPC SQL publish_shipping_tariff_version applique la même règle).
 * Aucun calcul de prix ici : le moteur reste priceFromTariff.
 */

import type { ShippingTariffVersionRow } from '@lepefy/types';
import { validateTariffFields, TARIFF_ERROR_LABELS, type TariffValidationError } from './tariffVersion';
import { zoneLabel } from './publicGrid';

/** Plafond de saisie par montant : 10 000 € (garde-fou de frappe, pas une règle commerciale). */
export const MAX_TARIFF_AMOUNT_CENTS = 1_000_000;

export interface TariffPriceEdits {
  /** Un prix par tranche, dans l'ordre des tranches de la base. */
  bandPricesCents: number[];
  /** Prix d'un bloc au-delà du poids couvert ; null si la base n'a pas de bloc. */
  blockPriceCents: number | null;
  /** zone_code → montant, exactement les zones de la base. */
  surchargesCents: Record<string, number>;
}

type BaseVersion = Pick<ShippingTariffVersionRow,
  'country' | 'currency' | 'bands' | 'zone_surcharges' | 'non_deliverable_zones' | 'max_parcel_weight_g'
  | 'block_weight_g' | 'block_price_cents' | 'logistics_verified_max_weight_g' | 'prices_include_vat'>;

/**
 * Montant saisi en français → centimes entiers. Accepte « 8,9 », « 8,90 », « 8.90 »,
 * « 8 », « 8,90 € », espaces (y compris insécables). null si vide, négatif, plus de
 * deux décimales, non numérique ou au-delà du plafond.
 */
export function parseEuroAmount(input: string): number | null {
  const text = input.replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [units, decimals = ''] = text.split('.');
  const cents = Number(units) * 100 + Number(decimals.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_TARIFF_AMOUNT_CENTS ? cents : null;
}

/** Centimes → valeur d'un champ de saisie (« 8,90 »), sans symbole. */
export function formatEuroInput(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

/** Centimes → montant affiché (« 8,90 € »). */
export function formatEuroCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

const kg = (g: number) => (g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

export function bandLabel(band: { min_g_exclusive: number; max_g_inclusive: number | null }): string {
  return band.max_g_inclusive === null ? `Plus de ${kg(band.min_g_exclusive)} kg` : `${kg(band.min_g_exclusive)} – ${kg(band.max_g_inclusive)} kg`;
}

export function blockLabel(blockWeightG: number): string {
  return `Par ${kg(blockWeightG)} kg en plus`;
}

export function surchargeLabel(zoneCode: string): string {
  return zoneLabel(zoneCode, 'fr');
}

/** Nom du pays en français (« Italie ») ; repli sur le code ISO. */
export function countryLabel(code: string): string {
  try {
    return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Drapeau emoji (indicateurs régionaux) ; chaîne vide si le code n'est pas ISO-2. */
export function countryFlag(code: string): string {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function editsFromVersion(version: BaseVersion): TariffPriceEdits {
  return {
    bandPricesCents: version.bands.map((b) => b.price_cents),
    blockPriceCents: version.block_weight_g != null ? version.block_price_cents : null,
    surchargesCents: Object.fromEntries(version.zone_surcharges.map((z) => [z.zone_code, z.amount_cents])),
  };
}

export type TariffEditError = 'structure_changed' | 'price_invalid' | TariffValidationError;

export const TARIFF_EDIT_ERROR_LABELS: Record<TariffEditError, string> = {
  ...TARIFF_ERROR_LABELS,
  structure_changed: 'La grille a changé de structure : rechargez les tarifs avant de publier.',
  price_invalid: 'Un montant est invalide : saisissez un prix positif en euros, par exemple 8,90.',
};

const validAmount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_TARIFF_AMOUNT_CENTS;

/**
 * Nouvelle version = base + nouveaux montants. Refuse toute différence de
 * structure (nombre de tranches, zones) et repasse la validation des versions.
 */
export function buildEditedVersion<T extends BaseVersion>(base: T, edits: TariffPriceEdits):
  | { ok: true; fields: T }
  | { ok: false; errors: TariffEditError[] } {
  const zoneCodes = base.zone_surcharges.map((z) => z.zone_code);
  const editZones = Object.keys(edits.surchargesCents ?? {});
  if (!Array.isArray(edits.bandPricesCents) || edits.bandPricesCents.length !== base.bands.length
    || editZones.length !== zoneCodes.length || zoneCodes.some((code) => !(code in edits.surchargesCents))
    || (base.block_weight_g == null) !== (edits.blockPriceCents == null)) {
    return { ok: false, errors: ['structure_changed'] };
  }
  if (!edits.bandPricesCents.every(validAmount) || !Object.values(edits.surchargesCents).every(validAmount)
    || (edits.blockPriceCents != null && !validAmount(edits.blockPriceCents))) {
    return { ok: false, errors: ['price_invalid'] };
  }
  const fields: T = {
    ...base,
    bands: base.bands.map((b, i) => ({ min_g_exclusive: b.min_g_exclusive, max_g_inclusive: b.max_g_inclusive, price_cents: edits.bandPricesCents[i]! })),
    zone_surcharges: base.zone_surcharges.map((z) => ({ zone_code: z.zone_code, mode: z.mode, amount_cents: edits.surchargesCents[z.zone_code]! })),
    block_price_cents: base.block_weight_g != null ? edits.blockPriceCents : base.block_price_cents,
  };
  const errors = validateTariffFields(fields);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, fields };
}

export interface TariffPriceChange {
  key: string;
  kind: 'band' | 'block' | 'surcharge';
  label: string;
  /** « par colis » / « par commande » pour un supplément. */
  hint: string | null;
  beforeCents: number;
  afterCents: number;
}

/** Montants modifiés uniquement, dans l'ordre d'affichage (tranches, bloc, suppléments). */
export function diffTariffPrices(base: BaseVersion, edits: TariffPriceEdits): TariffPriceChange[] {
  const changes: TariffPriceChange[] = [];
  base.bands.forEach((b, i) => {
    const after = edits.bandPricesCents[i];
    if (after !== undefined && after !== b.price_cents) {
      changes.push({ key: `band-${i}`, kind: 'band', label: bandLabel(b), hint: null, beforeCents: b.price_cents, afterCents: after });
    }
  });
  if (base.block_weight_g != null && base.block_price_cents != null && edits.blockPriceCents != null && edits.blockPriceCents !== base.block_price_cents) {
    changes.push({ key: 'block', kind: 'block', label: blockLabel(base.block_weight_g), hint: null, beforeCents: base.block_price_cents, afterCents: edits.blockPriceCents });
  }
  for (const z of base.zone_surcharges) {
    const after = edits.surchargesCents[z.zone_code];
    if (after !== undefined && after !== z.amount_cents) {
      changes.push({
        key: `zone-${z.zone_code}`, kind: 'surcharge', label: surchargeLabel(z.zone_code),
        hint: z.mode === 'per_parcel' ? 'par colis' : 'par commande', beforeCents: z.amount_cents, afterCents: after,
      });
    }
  }
  return changes;
}

/** Diff entre deux versions publiées (historique) ; null si la structure diffère. */
export function diffVersions(previous: BaseVersion, next: BaseVersion): TariffPriceChange[] | null {
  const sameStructure = previous.bands.length === next.bands.length
    && previous.bands.every((b, i) => b.min_g_exclusive === next.bands[i]!.min_g_exclusive && b.max_g_inclusive === next.bands[i]!.max_g_inclusive)
    && previous.block_weight_g === next.block_weight_g
    && previous.zone_surcharges.length === next.zone_surcharges.length
    && previous.zone_surcharges.every((z) => next.zone_surcharges.some((n) => n.zone_code === z.zone_code && n.mode === z.mode));
  if (!sameStructure) return null;
  return diffTariffPrices(previous, editsFromVersion(next));
}

// ─── Vue par pays et historique (page opérationnelle) ───────────────────────

export type CountryTariffStatus = 'active' | 'simulation' | 'not_configured';

export interface CountryTariffView {
  country: string;
  status: CountryTariffStatus;
  /** Version facturée (active) ou simulée (shadow) ; null si non configuré. */
  version: ShippingTariffVersionRow | null;
}

/**
 * Un pays par carte : la version active s'il y en a une (jamais remplacée par une
 * shadow), sinon la version shadow (« Simulation », jamais présentée comme facturée),
 * sinon « Non configuré » pour les pays connus par les zones ou règles du tenant.
 * Ordre : actifs, simulations, non configurés ; alphabétique par nom de pays.
 */
export function buildCountryTariffViews(
  versions: ShippingTariffVersionRow[],
  knownCountries: string[],
): CountryTariffView[] {
  const countries = new Set<string>([
    ...versions.filter((v) => v.status === 'active' || v.status === 'shadow').map((v) => v.country),
    ...knownCountries.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
  ]);
  const rank: Record<CountryTariffStatus, number> = { active: 0, simulation: 1, not_configured: 2 };
  return [...countries]
    .map((country): CountryTariffView => {
      const active = versions.find((v) => v.country === country && v.status === 'active');
      if (active) return { country, status: 'active', version: active };
      const shadow = versions.find((v) => v.country === country && v.status === 'shadow');
      if (shadow) return { country, status: 'simulation', version: shadow };
      return { country, status: 'not_configured', version: null };
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || countryLabel(a.country).localeCompare(countryLabel(b.country), 'fr'));
}

export interface TariffHistoryEntry {
  version: ShippingTariffVersionRow;
  current: boolean;
  /** Montants changés par rapport à la version précédemment en vigueur du pays ; null = première grille ou grille restructurée. */
  changes: TariffPriceChange[] | null;
  isFirst: boolean;
}

/**
 * Historique commercial : seulement les versions qui ont été facturées
 * (activated_at renseigné), de la plus récente à la plus ancienne. Les versions
 * de laboratoire (brouillon, validée, shadow jamais activée) n'y figurent pas.
 */
export function buildTariffHistory(versions: ShippingTariffVersionRow[]): TariffHistoryEntry[] {
  const billed = versions.filter((v) => v.activated_at).sort((a, b) => b.activated_at!.localeCompare(a.activated_at!));
  return billed.map((version) => {
    const previous = billed
      .filter((v) => v.country === version.country && v.activated_at! < version.activated_at!)
      .sort((a, b) => b.activated_at!.localeCompare(a.activated_at!))[0];
    return {
      version,
      current: version.status === 'active',
      changes: previous ? diffVersions(previous, version) : null,
      isFirst: !previous,
    };
  });
}
