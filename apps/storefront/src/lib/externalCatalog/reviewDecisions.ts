import { z } from 'zod';
import type { ExternalProductReviewDecision, NormalizedExternalProduct } from './types';

/**
 * Decisioni di revisione (dato confermato). In questo ciclo vivono SOLO in
 * `artifacts/whatsapp-catalog/review/decisions.json`: nessuna scrittura su
 * `products` né su altre tabelle.
 */

const positiveIntOrNull = z.number().int().min(1).max(10_000).nullable();

export const reviewDecisionSchema = z.object({
  source_product_id: z.string().min(1).max(200),
  status: z.enum(['pending', 'confirmed', 'rejected']),
  min_quantity: positiveIntOrNull,
  min_quantity_confirmed: z.boolean(),
  quantity_step: positiveIntOrNull,
  quantity_step_confirmed: z.boolean(),
  price_model: z.enum(['per_lot', 'per_unit', 'unknown']),
  price_model_confirmed: z.boolean(),
  note: z.string().max(1000).nullable(),
  updated_at: z.string().max(40),
}).superRefine((d, ctx) => {
  if (d.min_quantity_confirmed && d.min_quantity === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Minimo confermato senza valore.', path: ['min_quantity'] });
  }
  if (d.quantity_step_confirmed && d.quantity_step === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Step confermato senza valore.', path: ['quantity_step'] });
  }
  if (d.price_model_confirmed && d.price_model === 'unknown') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Modello di prezzo confermato come "sconosciuto".', path: ['price_model'] });
  }
});

export const reviewDecisionsFileSchema = z.object({
  version: z.literal(1),
  decisions: z.array(reviewDecisionSchema).max(5000),
});

export type ReviewDecisionsFile = z.infer<typeof reviewDecisionsFileSchema>;

/** Decisione iniziale: valori proposti PRE-compilati ma NON confermati. */
export function initialDecision(p: NormalizedExternalProduct, now: string): ExternalProductReviewDecision {
  return {
    source_product_id: p.source_product_id,
    status: 'pending',
    min_quantity: p.suggested_min_quantity,
    min_quantity_confirmed: false,
    quantity_step: p.suggested_quantity_step,
    quantity_step_confirmed: false,
    price_model: 'unknown',
    price_model_confirmed: false,
    note: null,
    updated_at: now,
  };
}

/**
 * Valida un file decisioni e tiene solo i prodotti noti (nessuna voce
 * arbitraria può essere iniettata). Restituisce una mappa per id.
 */
export function parseReviewDecisions(input: unknown, knownIds: Set<string>): Map<string, ExternalProductReviewDecision> {
  const parsed = reviewDecisionsFileSchema.parse(input);
  const out = new Map<string, ExternalProductReviewDecision>();
  for (const d of parsed.decisions) {
    if (knownIds.has(d.source_product_id)) out.set(d.source_product_id, d);
  }
  return out;
}

/** Unisce decisioni salvate e iniziali: una decisione salvata non viene mai sovrascritta da un nuovo parsing. */
export function mergeDecisions(
  products: NormalizedExternalProduct[],
  saved: Map<string, ExternalProductReviewDecision>,
  now: string,
): ExternalProductReviewDecision[] {
  return products.map((p) => saved.get(p.source_product_id) ?? initialDecision(p, now));
}
