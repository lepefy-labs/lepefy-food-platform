import { z } from 'zod';
import { BENEFICIARY_TYPES, PAYMENT_METHODS, PURCHASE_UNITS, isMoneyAmount } from '@/lib/gestion/domain';
import { canonicalConversion, canonicalQuantity } from '@/lib/gestion/quantity';

/**
 * Validazione degli input delle API Gestion. Il DB rivalida tutto: qui si
 * rifiutano presto i payload malformati con un messaggio chiaro.
 */

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable()
  .transform((value) => (value ? value : null));

const requestKey = z.string().trim().min(8).max(200);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.');
const nullableDate = isoDate.optional().nullable().or(z.literal('')).transform((value) => (value ? value : null));
const uuid = z.string().uuid();
// Arrondi au centime : un flottant JS (0.1 + 0.2) ne doit jamais arriver tel quel à la RPC.
const money = z.number().refine(isMoneyAmount, 'Montant invalide.').transform((value) => Math.round(value * 100) / 100);

/**
 * Quantité décimale (3 décimales au plus, jamais arrondie) transmise à la RPC
 * sous forme de chaîne canonique (« 12.5 ») : aucun flottant JS ne fait autorité.
 */
const quantity = (positive: boolean) => z.union([z.string(), z.number()]).transform((value, ctx) => {
  const canonical = canonicalQuantity(value);
  if (canonical === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Quantité invalide (3 décimales au plus).' });
    return z.NEVER;
  }
  if (positive && canonical === '0') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La quantité doit être positive.' });
    return z.NEVER;
  }
  return canonical;
});

/** Conversion vers les unités de stock (positive, 6 décimales au plus). */
const conversion = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const canonical = canonicalConversion(value);
  if (canonical === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Conversion invalide (nombre positif, 6 décimales au plus).' });
    return z.NEVER;
  }
  return canonical;
});

export const supplierFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire.').max(200),
  legal_name: optionalText(200),
  contact_name: optionalText(200),
  email: z.string().trim().max(254).email('Email invalide.').optional().nullable().or(z.literal('')).transform((value) => (value ? value : null)),
  phone: optionalText(40),
  whatsapp_phone: optionalText(40),
  address: optionalText(500),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Code pays sur 2 lettres.').optional().nullable().or(z.literal('')).transform((value) => (value ? value : null)),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  notes: optionalText(4000),
  active: z.boolean().optional(),
  // Conditions de paiement en jours (null = non définies) ; jamais une énumération figée.
  default_payment_terms_days: z.number().int().min(0, 'Conditions invalides.').max(3650, 'Au plus 3650 jours.').nullable().optional(),
});

export const createSupplierSchema = supplierFieldsSchema.extend({ requestKey });
export const updateSupplierSchema = supplierFieldsSchema.partial();

export const purchaseItemSchema = z.object({
  product_id: uuid.optional().nullable(),
  description: optionalText(300),
  ordered_quantity: quantity(true),
  purchase_unit: z.enum(PURCHASE_UNITS).default('unit'),
  stock_units_per_purchase_unit: conversion.optional().nullable(),
  unit_cost: z.number().min(0).max(10_000_000),
}).refine((item) => item.product_id || item.description, { message: 'Chaque article doit avoir une description.' });

export const purchaseFieldsSchema = z.object({
  supplier_reference: optionalText(120),
  order_date: isoDate.optional(),
  expected_date: nullableDate,
  // Échéance de paiement (financière), distincte de la livraison prévue.
  payment_due_date: nullableDate,
  additional_costs: z.number().min(0).max(10_000_000).optional(),
  notes: optionalText(4000),
});

export const createPurchaseSchema = purchaseFieldsSchema.extend({
  supplier_id: uuid,
  status: z.enum(['draft', 'ordered']).default('draft'),
  items: z.array(purchaseItemSchema).max(200),
  requestKey,
});

// partial(): un champ absent reste absent (la RPC ne modifie que les clés présentes).
export const updatePurchaseSchema = purchaseFieldsSchema.partial().extend({
  items: z.array(purchaseItemSchema).max(200).optional(),
});

export const purchaseStatusSchema = z.object({
  status: z.enum(['ordered', 'cancelled']),
  reason: optionalText(1000),
});

export const dueDateSchema = z.object({ payment_due_date: nullableDate });

export const receiptSchema = z.object({
  items: z.array(z.object({ purchase_item_id: uuid, quantity: quantity(false) })).min(1).max(200),
  received_at: z.string().datetime({ offset: true }).optional().nullable(),
  notes: optionalText(4000),
  requestKey,
}).refine((receipt) => receipt.items.some((item) => item.quantity !== '0'), { message: 'Indiquez au moins une quantité reçue.' });

export const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Motif trop court.').max(1000) });

export const adjustmentSchema = z.object({
  product_id: uuid,
  delta: z.number().int('La variation est un nombre entier d\'unités de stock.')
    .refine((value) => value !== 0, 'La variation ne peut pas être nulle.')
    .refine((value) => Math.abs(value) <= 1_000_000, 'Variation trop grande.'),
  reason: z.string().trim().min(3, 'Motif obligatoire.').max(300),
  note: optionalText(1000),
  requestKey,
});

export const allocationInputSchema = z.object({ purchase_id: uuid, amount: money });

export const createPaymentSchema = z.object({
  supplier_id: uuid,
  amount: money,
  payment_date: isoDate,
  method: z.enum(PAYMENT_METHODS),
  payer_account: optionalText(120),
  beneficiary_type: z.enum(BENEFICIARY_TYPES).default('supplier'),
  beneficiary_name: optionalText(200),
  beneficiary_reference: optionalText(200),
  supplier_instruction_note: optionalText(2000),
  external_reference: optionalText(200),
  notes: optionalText(4000),
  allocations: z.array(allocationInputSchema).max(50).default([]),
  requestKey,
}).refine((payment) => payment.beneficiary_type === 'supplier' || Boolean(payment.beneficiary_name), {
  message: 'Le nom du bénéficiaire est obligatoire pour un paiement à un tiers.',
  path: ['beneficiary_name'],
});

export const allocateSchema = allocationInputSchema.extend({ requestKey });

/** Primo messaggio leggibile di un errore zod. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Données invalides.';
}
