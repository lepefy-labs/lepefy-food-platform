/**
 * Validazione delle versioni tariffarie immutabili e conversione da bozza.
 *
 * Pure functions: usate dall'API admin prima dell'inserimento e dal servizio
 * shadow a ogni lettura (una riga non valida non viene mai prezzata).
 */

import type {
  ShippingTariffDraftRow,
  ShippingTariffVersionBand,
  ShippingTariffVersionRow,
  ShippingTariffVersionZoneSurcharge,
} from '@lepefy/types';
import type { TariffSnapshot } from './priceFromTariff';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Codici errore stabili (mostrati in admin tramite TARIFF_ERROR_LABELS). */
export type TariffValidationError =
  | 'bands_empty'
  | 'band_invalid'
  | 'bands_not_starting_at_zero'
  | 'bands_not_contiguous'
  | 'band_unbounded_not_last'
  | 'max_parcel_invalid'
  | 'block_incomplete'
  | 'block_invalid'
  | 'bands_do_not_cover_block'
  | 'zone_surcharge_invalid'
  | 'zone_surcharge_duplicate'
  | 'country_invalid'
  | 'currency_invalid'
  | 'logistics_limit_invalid'
  | 'strategy_unsupported';

export const TARIFF_ERROR_LABELS: Record<TariffValidationError, string> = {
  bands_empty: 'Aucune tranche de poids.',
  band_invalid: 'Tranche invalide (poids en grammes entiers, max > min, prix ≥ 0).',
  bands_not_starting_at_zero: 'La première tranche doit commencer à 0 kg.',
  bands_not_contiguous: 'Les tranches doivent se suivre sans trou ni chevauchement.',
  band_unbounded_not_last: 'Seule la dernière tranche peut être sans limite.',
  max_parcel_invalid: 'Poids maximum par colis invalide.',
  block_incomplete: 'Le bloc demande à la fois un poids et un prix.',
  block_invalid: 'Bloc invalide.',
  bands_do_not_cover_block: 'Les tranches doivent couvrir tout le poids d’un bloc.',
  zone_surcharge_invalid: 'Supplément de zone invalide.',
  zone_surcharge_duplicate: 'Une zone a plusieurs suppléments.',
  country_invalid: 'Pays invalide (code ISO à 2 lettres).',
  currency_invalid: 'Devise invalide.',
  logistics_limit_invalid: 'Limite logistique vérifiée invalide.',
  strategy_unsupported: 'Stratégie multi-colis non prise en charge : le forfait s’applique au poids total de la commande.',
};

type VersionFields = Pick<ShippingTariffVersionRow,
  'country' | 'currency' | 'bands' | 'zone_surcharges' | 'non_deliverable_zones' | 'max_parcel_weight_g'
  | 'block_weight_g' | 'block_price_cents' | 'logistics_verified_max_weight_g' | 'prices_include_vat'>;

export function validateTariffFields(fields: VersionFields): TariffValidationError[] {
  const errors: TariffValidationError[] = [];
  if (typeof fields.country !== 'string' || !/^[A-Z]{2}$/.test(fields.country)) errors.push('country_invalid');
  if (typeof fields.currency !== 'string' || !/^[A-Z]{3}$/.test(fields.currency)) errors.push('currency_invalid');

  const bands = Array.isArray(fields.bands) ? fields.bands : [];
  if (bands.length === 0) errors.push('bands_empty');
  const bandsValid = bands.every((b) => b && isInt(b.min_g_exclusive) && b.min_g_exclusive >= 0
    && (b.max_g_inclusive === null || (isInt(b.max_g_inclusive) && b.max_g_inclusive > b.min_g_exclusive))
    && isInt(b.price_cents) && b.price_cents >= 0);
  if (!bandsValid) errors.push('band_invalid');
  if (bandsValid && bands.length > 0) {
    if (bands[0]!.min_g_exclusive !== 0) errors.push('bands_not_starting_at_zero');
    for (let i = 1; i < bands.length; i += 1) {
      if (bands[i - 1]!.max_g_inclusive === null) { errors.push('band_unbounded_not_last'); break; }
      if (bands[i]!.min_g_exclusive !== bands[i - 1]!.max_g_inclusive) { errors.push('bands_not_contiguous'); break; }
    }
  }

  if (!isInt(fields.max_parcel_weight_g) || fields.max_parcel_weight_g <= 0) errors.push('max_parcel_invalid');

  const hasBlockWeight = fields.block_weight_g !== null && fields.block_weight_g !== undefined;
  const hasBlockPrice = fields.block_price_cents !== null && fields.block_price_cents !== undefined;
  if (hasBlockWeight !== hasBlockPrice) errors.push('block_incomplete');
  if (hasBlockWeight && hasBlockPrice) {
    if (!isInt(fields.block_weight_g) || fields.block_weight_g! <= 0 || !isInt(fields.block_price_cents) || fields.block_price_cents! < 0) {
      errors.push('block_invalid');
    } else if (bandsValid && bands.length > 0) {
      const last = bands[bands.length - 1]!;
      if (last.max_g_inclusive !== null && last.max_g_inclusive < fields.block_weight_g!) errors.push('bands_do_not_cover_block');
    }
  }

  const surcharges = Array.isArray(fields.zone_surcharges) ? fields.zone_surcharges : null;
  if (!surcharges || surcharges.some((z) => !z || typeof z.zone_code !== 'string' || !z.zone_code.trim()
    || !isInt(z.amount_cents) || z.amount_cents < 0 || (z.mode !== 'per_parcel' && z.mode !== 'per_order'))) {
    errors.push('zone_surcharge_invalid');
  } else if (new Set(surcharges.map((z) => z.zone_code)).size !== surcharges.length) {
    errors.push('zone_surcharge_duplicate');
  }

  if (fields.logistics_verified_max_weight_g !== null && fields.logistics_verified_max_weight_g !== undefined
    && (!isInt(fields.logistics_verified_max_weight_g) || fields.logistics_verified_max_weight_g <= 0)) {
    errors.push('logistics_limit_invalid');
  }
  return errors;
}

/** Riga DB → snapshot per il motore. Una riga incoerente non viene mai prezzata. */
export function parseTariffVersion(row: ShippingTariffVersionRow):
  | { ok: true; tariff: TariffSnapshot }
  | { ok: false; errors: TariffValidationError[] } {
  const errors = validateTariffFields(row);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    tariff: {
      id: row.id,
      version: row.version,
      country: row.country,
      currency: row.currency,
      bands: row.bands,
      zoneSurcharges: row.zone_surcharges,
      nonDeliverableZones: row.non_deliverable_zones ?? [],
      maxParcelWeightG: row.max_parcel_weight_g,
      blockWeightG: row.block_weight_g,
      blockPriceCents: row.block_price_cents,
      logisticsVerifiedMaxWeightG: row.logistics_verified_max_weight_g,
      pricesIncludeVat: row.prices_include_vat,
    },
  };
}

export interface VersionFromDraftOptions {
  country: string;
  currency?: string;
  pricesIncludeVat: boolean;
  maxParcelKg: number;
  blockKg?: number | null;
  blockPrice?: number | null;
  nonDeliverableZones?: string[];
  logisticsVerifiedMaxKg?: number | null;
}

export type VersionPayload = VersionFields & { name: string; source_draft_id: string };

const toG = (kg: number) => Math.round(kg * 1000);
const toCents = (eur: number) => Math.round(eur * 100);

/**
 * Converte una bozza del laboratorio in una versione immutabile.
 * Le bande della bozza (`minKg`–`maxKg`) diventano `min < peso ≤ max` in
 * grammi. Solo il modello «prezzo sul poids total» è supportato: le strategie
 * «1er colis + …» non hanno equivalente nel motore V1F e vengono rifiutate.
 */
export function buildVersionFromDraft(
  draft: Pick<ShippingTariffDraftRow, 'id' | 'name' | 'bands' | 'zone_surcharges' | 'multi_parcel_strategy'>,
  opts: VersionFromDraftOptions,
): { ok: true; payload: VersionPayload } | { ok: false; errors: TariffValidationError[] } {
  const strategy = draft.multi_parcel_strategy;
  if (strategy && strategy.type !== 'weight_bands_whole_order') return { ok: false, errors: ['strategy_unsupported'] };
  const surchargeMode = strategy?.zoneSurchargeMode === 'per_parcel' ? 'per_parcel' : 'per_order';

  const bands: ShippingTariffVersionBand[] = [...draft.bands]
    .sort((a, b) => a.minKg - b.minKg)
    .map((b) => ({
      min_g_exclusive: toG(b.minKg),
      max_g_inclusive: b.maxKg === null ? null : toG(b.maxKg),
      price_cents: toCents(b.price),
    }));
  const zone_surcharges: ShippingTariffVersionZoneSurcharge[] = Object.entries(draft.zone_surcharges ?? {})
    .filter(([, amount]) => Number.isFinite(Number(amount)))
    .map(([zone_code, amount]) => ({ zone_code: zone_code.trim(), amount_cents: toCents(Number(amount)), mode: surchargeMode }));

  const hasBlock = opts.blockKg != null && opts.blockPrice != null;
  const payload: VersionPayload = {
    name: draft.name,
    source_draft_id: draft.id,
    country: opts.country.trim().toUpperCase(),
    currency: (opts.currency ?? 'EUR').trim().toUpperCase(),
    bands,
    zone_surcharges,
    non_deliverable_zones: [...new Set((opts.nonDeliverableZones ?? []).map((z) => z.trim()).filter(Boolean))],
    max_parcel_weight_g: toG(opts.maxParcelKg),
    block_weight_g: opts.blockKg != null ? toG(opts.blockKg) : null,
    block_price_cents: opts.blockPrice != null ? toCents(opts.blockPrice) : null,
    logistics_verified_max_weight_g: opts.logisticsVerifiedMaxKg != null ? toG(opts.logisticsVerifiedMaxKg) : null,
    prices_include_vat: opts.pricesIncludeVat,
  };
  if (!hasBlock && (opts.blockKg != null || opts.blockPrice != null)) return { ok: false, errors: ['block_incomplete'] };
  const errors = validateTariffFields(payload);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, payload };
}
