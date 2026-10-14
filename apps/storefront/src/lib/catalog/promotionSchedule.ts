/**
 * Promotions programmées côté admin (migration 156). Même règle que la
 * fonction SQL `apply_product_promotion_schedule` et que le trigger
 * « épuisement des stocks » : `price` est toujours le prix payé.
 *
 *   en cours       price = prix promo, compare_at_price = prix normal, promo_applied
 *   programmée     price = prix normal, compare_at_price = null, promo_* renseignées
 *   manuelle       ancienne promo sans date : price < compare_at_price, promo_price null
 *
 * L'éditeur envoie `{ regular_price, promo }` ; l'API calcule ici les colonnes
 * à écrire pour l'instant présent, puis le tick n8n fait les transitions à date.
 * Pur et testé.
 */

export interface PromotionInput {
  price: number | string;
  /** ISO UTC, null = dès l'enregistrement. */
  starts_at: string | null;
  /** ISO UTC, null = sans date de fin. */
  ends_at: string | null;
  until_sold_out: boolean;
}

export interface PricingInput {
  regular_price: number | string;
  promo: PromotionInput | null;
}

export interface PricingColumns {
  price: number;
  compare_at_price: number | null;
  promo_price: number | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  promo_until_sold_out: boolean;
  promo_applied: boolean;
}

export interface PricingRow {
  price: number;
  compare_at_price: number | null;
  promo_price?: number | null;
  promo_starts_at?: string | null;
  promo_ends_at?: string | null;
  promo_until_sold_out?: boolean | null;
  promo_applied?: boolean | null;
}

export type PromotionState = 'none' | 'manual' | 'scheduled' | 'active';

export const PRICING_COPY = {
  invalidRegular: 'Le prix normal doit être un montant positif.',
  invalidPromo: 'Le prix promo doit être un montant positif.',
  promoNotLower: 'Le prix promo doit être inférieur au prix normal.',
  invalidDate: 'Date de promotion invalide.',
  endBeforeStart: 'La fin de la promotion doit être après son début.',
  endInPast: 'La date de fin de la promotion est déjà passée.',
  soldOutWithoutStock: 'Stock épuisé : une promotion « jusqu’à épuisement des stocks » ne peut pas commencer.',
} as const;

function money(raw: number | string): number {
  const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').trim());
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
}

function instant(raw: string | null): number | null | typeof NaN {
  if (raw == null || raw === '') return null;
  const value = Date.parse(raw);
  return Number.isNaN(value) ? NaN : value;
}

/** Le stock ne couvre plus le minimum d'achat (même définition que le trigger SQL). */
export function isSoldOutForPromotion(stock: number, minimum: number): boolean {
  return stock < Math.max(1, Math.trunc(minimum) || 1);
}

/** Colonnes à écrire pour ce prix normal / cette promotion, maintenant. */
export function resolvePricingColumns(
  input: PricingInput,
  context: { stock: number; minimum: number },
  now: Date = new Date(),
): { ok: true; columns: PricingColumns } | { ok: false; error: string } {
  const regular = money(input.regular_price);
  if (!Number.isFinite(regular) || regular <= 0) return { ok: false, error: PRICING_COPY.invalidRegular };

  if (!input.promo) {
    return { ok: true, columns: {
      price: regular, compare_at_price: null, promo_price: null, promo_starts_at: null,
      promo_ends_at: null, promo_until_sold_out: false, promo_applied: false,
    } };
  }

  const promoPrice = money(input.promo.price);
  if (!Number.isFinite(promoPrice) || promoPrice <= 0) return { ok: false, error: PRICING_COPY.invalidPromo };
  if (promoPrice >= regular) return { ok: false, error: PRICING_COPY.promoNotLower };

  const start = instant(input.promo.starts_at);
  const end = instant(input.promo.ends_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return { ok: false, error: PRICING_COPY.invalidDate };
  if (start != null && end != null && end <= start) return { ok: false, error: PRICING_COPY.endBeforeStart };
  if (end != null && end <= now.getTime()) return { ok: false, error: PRICING_COPY.endInPast };

  const untilSoldOut = Boolean(input.promo.until_sold_out);
  if (untilSoldOut && isSoldOutForPromotion(context.stock, context.minimum)) {
    return { ok: false, error: PRICING_COPY.soldOutWithoutStock };
  }

  const active = start == null || start <= now.getTime();
  return { ok: true, columns: {
    price: active ? promoPrice : regular,
    compare_at_price: active ? regular : null,
    promo_price: promoPrice,
    promo_starts_at: start == null ? null : new Date(start).toISOString(),
    promo_ends_at: end == null ? null : new Date(end).toISOString(),
    promo_until_sold_out: untilSoldOut,
    promo_applied: active,
  } };
}

/** État d'une ligne produit, pour l'éditeur et la liste admin. */
export function promotionState(row: PricingRow): PromotionState {
  if (row.promo_applied) return 'active';
  if (row.promo_price != null) return 'scheduled';
  if (row.compare_at_price != null && Number(row.compare_at_price) > Number(row.price)) return 'manual';
  return 'none';
}

/** Valeur de l'éditeur pour une ligne : prix normal + promotion éventuelle. */
export function pricingInputFromRow(row: PricingRow): PricingInput {
  const state = promotionState(row);
  if (state === 'active') {
    return { regular_price: Number(row.compare_at_price ?? row.price), promo: {
      price: Number(row.promo_price ?? row.price), starts_at: row.promo_starts_at ?? null,
      ends_at: row.promo_ends_at ?? null, until_sold_out: Boolean(row.promo_until_sold_out),
    } };
  }
  if (state === 'scheduled') {
    return { regular_price: Number(row.price), promo: {
      price: Number(row.promo_price), starts_at: row.promo_starts_at ?? null,
      ends_at: row.promo_ends_at ?? null, until_sold_out: Boolean(row.promo_until_sold_out),
    } };
  }
  if (state === 'manual') {
    // Ancienne promo sans date : déjà en cours, aucune programmation.
    return { regular_price: Number(row.compare_at_price), promo: {
      price: Number(row.price), starts_at: null, ends_at: null, until_sold_out: false,
    } };
  }
  return { regular_price: Number(row.price), promo: null };
}


/** Corps `pricing` envoyé par l'éditeur admin ; null si la forme est invalide. */
export function parsePricingBody(raw: unknown): PricingInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const regular = body.regular_price;
  if (typeof regular !== 'number' && typeof regular !== 'string') return null;
  if (body.promo == null) return { regular_price: regular, promo: null };
  if (typeof body.promo !== 'object') return null;
  const promo = body.promo as Record<string, unknown>;
  if (typeof promo.price !== 'number' && typeof promo.price !== 'string') return null;
  const date = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return {
    regular_price: regular,
    promo: {
      price: promo.price,
      starts_at: date(promo.starts_at),
      ends_at: date(promo.ends_at),
      until_sold_out: promo.until_sold_out === true,
    },
  };
}

/** Colonnes de prix écrites par l'API (ordre stable pour le select courant). */
export const PRICING_ROW_COLUMNS = 'price, compare_at_price, promo_price, promo_starts_at, promo_ends_at, promo_until_sold_out, promo_applied, stock, min_order_quantity';
