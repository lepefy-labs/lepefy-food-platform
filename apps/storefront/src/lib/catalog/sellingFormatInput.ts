// Product editor → products.sale_unit / net_content_value / net_content_unit /
// pack_count (migration 154). Shared by the create and PATCH routes and by the
// editor's own check, so the three never disagree. Pure.

import { SALE_UNIT_KEYS } from '../storefrontCopy/saleUnits';
import { CONTENT_UNITS } from '../storefrontCopy/sellingFormat';

export const SELLING_FORMAT_FIELDS = ['sale_unit', 'net_content_value', 'net_content_unit', 'pack_count'] as const;
export type SellingFormatField = (typeof SELLING_FORMAT_FIELDS)[number];

export interface SellingFormatValues {
  sale_unit?: string | null;
  net_content_value?: number | null;
  net_content_unit?: string | null;
  pack_count?: number | null;
}

export type SellingFormatParse =
  | { ok: true; values: SellingFormatValues }
  | { ok: false; error: string };

function blank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Reads only the keys present in `body` (PATCH semantics). Blank = null.
 * When the body carries both content fields they must be set together (the DB
 * constraint products_net_content_pair enforces the same on partial updates).
 */
export function parseSellingFormatInput(body: Record<string, unknown>): SellingFormatParse {
  const values: SellingFormatValues = {};

  if ('sale_unit' in body) {
    if (blank(body.sale_unit)) values.sale_unit = null;
    else {
      const key = String(body.sale_unit).trim().toLowerCase();
      if (!SALE_UNIT_KEYS.includes(key)) return { ok: false, error: 'Unité de vente inconnue.' };
      values.sale_unit = key;
    }
  }

  if ('net_content_value' in body) {
    if (blank(body.net_content_value)) values.net_content_value = null;
    else {
      const raw = String(body.net_content_value).trim().replace(',', '.');
      const value = Number(raw);
      if (!/^\d+(\.\d{1,3})?$/.test(raw) || value <= 0 || value >= 10_000_000) {
        return { ok: false, error: 'Le contenu net doit être un nombre positif (3 décimales au plus).' };
      }
      values.net_content_value = value;
    }
  }

  if ('net_content_unit' in body) {
    if (blank(body.net_content_unit)) values.net_content_unit = null;
    else {
      const unit = String(body.net_content_unit).trim().toLowerCase();
      if (!(CONTENT_UNITS as readonly string[]).includes(unit)) return { ok: false, error: 'Unité de contenu inconnue (g, kg, ml, cl, l).' };
      values.net_content_unit = unit;
    }
  }

  if ('pack_count' in body) {
    if (blank(body.pack_count)) values.pack_count = null;
    else {
      const count = Number(body.pack_count);
      if (!Number.isInteger(count) || count < 1 || count > 999) {
        return { ok: false, error: 'Le nombre d’éléments par lot doit être un entier entre 1 et 999 (vide ou 1 : vendu seul).' };
      }
      // 1 = un seul élément, pas un lot : enregistré comme « vide ».
      values.pack_count = count === 1 ? null : count;
    }
  }

  if ('net_content_value' in values && 'net_content_unit' in values
    && (values.net_content_value == null) !== (values.net_content_unit == null)) {
    return { ok: false, error: 'Indiquez le contenu net et son unité ensemble.' };
  }

  return { ok: true, values };
}
