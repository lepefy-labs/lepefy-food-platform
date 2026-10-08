import { z } from 'zod';
import { MAX_DISCOUNT_PCT } from '../pricing';

/** Schemi delle richieste della console "Catalogues WhatsApp". Puri, testabili. */

const discount = z.number().min(0).max(MAX_DISCOUNT_PCT).multipleOf(0.01);

export const createSourceSchema = z.object({
  tenantId: z.string().uuid(),
  label: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(300),
  sellerPhone: z.string().trim().min(6).max(30),
  discountPct: discount.default(0),
});

export const updateSourceSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  discountPct: discount.optional(),
  consentStatus: z.enum(['missing', 'granted', 'revoked']).optional(),
  consentNote: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'empty' })
  .refine((v) => v.consentStatus !== 'granted' || Boolean(v.consentNote && v.consentNote.length >= 5), {
    message: 'consent_note_required', path: ['consentNote'],
  });

const priceString = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).refine((v) => Number(v) > 0);
const positiveIntString = z.union([z.number().int(), z.string().regex(/^\d{1,5}$/)])
  .transform((v) => Number(v))
  .refine((v) => Number.isInteger(v) && v >= 1 && v <= 10_000);

export const applyItemSchema = z.object({
  mode: z.enum(['create', 'update']),
  productId: z.string().uuid().nullable().default(null),
  requestKey: z.string().uuid(),
  images: z.boolean().default(false),
  fields: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    price: priceString.optional(),
    min_order_quantity: positiveIntString.optional(),
    order_quantity_step: positiveIntString.optional(),
    weight_grams: z.union([z.number().int().min(1).max(1_000_000), z.null()]).optional(),
    net_quantity_display: z.string().trim().max(100).nullable().optional(),
    category_id: z.string().uuid().nullable().optional(),
  }).strict(),
}).superRefine((v, ctx) => {
  if (v.mode === 'update' && !v.productId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'product_required', path: ['productId'] });
  if (v.mode === 'create' && (!v.fields.name || !v.fields.price)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'name_and_price_required', path: ['fields'] });
  }
  if (Object.keys(v.fields).length === 0 && !v.images) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'nothing_to_apply', path: ['fields'] });
  }
});

export type ApplyItemRequest = z.infer<typeof applyItemSchema>;

/** Campi per la RPC: stringhe come le valida l'SQL; null = svuota il campo. */
export function toRpcFields(fields: ApplyItemRequest['fields']): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = typeof value === 'number' ? String(value) : value;
  }
  return out;
}

export const itemStatusSchema = z.object({ action: z.enum(['dismiss', 'restore']) });
