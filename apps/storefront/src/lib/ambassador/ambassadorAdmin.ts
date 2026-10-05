import { z } from 'zod';
import type { AmbassadorCommissionMode, AmbassadorCommissionStatus, AmbassadorDiscountType } from '@lepefy/types';
import { calculateSplitPoolAmounts } from './calculateSplitPool';

/** Program settings as edited in /admin/ambassadeurs (tenants.ambassador_* columns, 046/051). */
export interface AmbassadorSettings {
  ambassador_min_purchase_amount: number;
  ambassador_min_commission_amount: number;
  ambassador_max_commission_amount: number;
  ambassador_loyalty_from_second_order: boolean;
  ambassador_first_order_discount_type: AmbassadorDiscountType | null;
  ambassador_first_order_discount_value: number | null;
  ambassador_payout_threshold_amount: number;
  ambassador_commission_mode: AmbassadorCommissionMode;
  ambassador_split_pool_amount: number | null;
  ambassador_split_pool_ambassador_percent: number | null;
}

const money = z.number().finite().min(0).max(100_000);

export const ambassadorSettingsSchema = z.object({
  ambassador_min_purchase_amount: money,
  ambassador_min_commission_amount: money,
  ambassador_max_commission_amount: money,
  ambassador_loyalty_from_second_order: z.boolean(),
  ambassador_first_order_discount_type: z.enum(['PERCENT', 'FIXED']).nullable(),
  ambassador_first_order_discount_value: money.nullable(),
  ambassador_payout_threshold_amount: money,
  ambassador_commission_mode: z.enum(['PROPORTIONAL', 'SPLIT_POOL']),
  ambassador_split_pool_amount: money.nullable(),
  ambassador_split_pool_ambassador_percent: z.number().finite().min(0).max(100).nullable(),
}).strict();

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Invariants checked by the settings API before writing and shown live in the
 * form. Each one prevents a configuration that would silently break the
 * program: a zero threshold divides by zero in process_ambassador_commission_atomic
 * at delivery, an empty pool never creates a commission, a discount above the
 * threshold can exceed the order itself.
 */
export function ambassadorSettingsIssues(s: AmbassadorSettings): string[] {
  const issues: string[] = [];
  if (!(s.ambassador_min_purchase_amount > 0)) {
    issues.push('L’achat minimum doit être supérieur à 0 (il sert de base au calcul de la commission).');
  }
  if (s.ambassador_commission_mode === 'SPLIT_POOL') {
    if (!(Number(s.ambassador_split_pool_amount) > 0)) {
      issues.push('Le pool doit être supérieur à 0 : sans pool, aucune commission n’est générée.');
    }
    const percent = s.ambassador_split_pool_ambassador_percent;
    if (percent == null || percent < 0 || percent > 100) {
      issues.push('La part ambassadeur doit être comprise entre 0 et 100 %.');
    }
    const { referredDiscount } = calculateSplitPoolAmounts({
      poolAmount: s.ambassador_split_pool_amount,
      ambassadorPercent: s.ambassador_split_pool_ambassador_percent,
    });
    if (s.ambassador_min_purchase_amount > 0 && referredDiscount > s.ambassador_min_purchase_amount) {
      issues.push('La réduction du client invité ne peut pas dépasser l’achat minimum.');
    }
  } else {
    if (s.ambassador_min_purchase_amount > 0 && s.ambassador_min_commission_amount > s.ambassador_min_purchase_amount) {
      issues.push('La commission au seuil ne peut pas dépasser l’achat minimum (taux supérieur à 100 %).');
    }
    if (s.ambassador_max_commission_amount < s.ambassador_min_commission_amount) {
      issues.push('Le plafond doit être au moins égal à la commission au seuil.');
    }
    if (s.ambassador_first_order_discount_type) {
      const value = Number(s.ambassador_first_order_discount_value);
      if (!(value > 0)) issues.push('Indiquez la valeur de la réduction, ou désactivez-la.');
      else if (s.ambassador_first_order_discount_type === 'PERCENT' && value > 100) issues.push('Une réduction en pourcentage ne peut pas dépasser 100 %.');
      else if (s.ambassador_first_order_discount_type === 'FIXED' && value > s.ambassador_min_purchase_amount) {
        issues.push('Une réduction fixe ne peut pas dépasser l’achat minimum.');
      }
    }
  }
  return issues;
}

/** Normalizes a settings payload: hidden fields of the inactive mode are kept as-is, the disabled discount has no value. */
export function normalizeAmbassadorSettings(s: AmbassadorSettings): AmbassadorSettings {
  return {
    ...s,
    ambassador_first_order_discount_value: s.ambassador_first_order_discount_type ? s.ambassador_first_order_discount_value : null,
  };
}

/** Commission rate derived from the threshold pair (never stored on tenants, historised per row). */
export function derivedCommissionRate(minPurchase: number, commissionAtThreshold: number): number {
  return minPurchase > 0 ? commissionAtThreshold / minPurchase : 0;
}

/** Same formula as the PROPORTIONAL branch of process_ambassador_commission_atomic (051). */
export function proportionalCommission(amountPaid: number, rate: number, max: number): number {
  return round2(Math.min(amountPaid * rate, max));
}

export function settingsEqual(a: AmbassadorSettings, b: AmbassadorSettings): boolean {
  return (Object.keys(a) as (keyof AmbassadorSettings)[]).every((key) => a[key] === b[key]);
}

// ─── Payouts ────────────────────────────────────────────────────────────────

export type PayoutState = 'nothing' | 'profile_incomplete' | 'below_threshold' | 'ready';

export function payoutState(balance: number, threshold: number, profileComplete: boolean): PayoutState {
  if (!(balance > 0)) return 'nothing';
  if (!profileComplete) return 'profile_incomplete';
  return balance >= threshold ? 'ready' : 'below_threshold';
}

export function maskIban(iban: string): string {
  const compact = iban.replace(/\s+/g, '');
  if (compact.length <= 8) return compact;
  return `${compact.slice(0, 4)} •••• ${compact.slice(-4)}`;
}

export interface PayoutDestination {
  method: 'IBAN' | 'PAYPAL';
  label: string;
  value: string;
  masked: string;
}

export function payoutDestination(row: {
  ambassador_payment_method: 'IBAN' | 'PAYPAL' | null;
  ambassador_iban?: string | null;
  ambassador_paypal_email?: string | null;
}): PayoutDestination | null {
  if (row.ambassador_payment_method === 'IBAN' && row.ambassador_iban) {
    const value = row.ambassador_iban.replace(/\s+/g, '');
    return { method: 'IBAN', label: 'IBAN', value, masked: maskIban(value) };
  }
  if (row.ambassador_payment_method === 'PAYPAL' && row.ambassador_paypal_email) {
    return { method: 'PAYPAL', label: 'PayPal', value: row.ambassador_paypal_email, masked: row.ambassador_paypal_email };
  }
  return null;
}

export function ambassadorDisplayName(row: {
  ambassador_first_name?: string | null;
  ambassador_last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
}): string {
  if (row.ambassador_first_name && row.ambassador_last_name) return `${row.ambassador_first_name} ${row.ambassador_last_name}`;
  return row.full_name || row.email || '—';
}

/** Transfer reference pre-filled in the payout modal: « Commission ambassadeur Rossi 2026-10 ». */
export function defaultPayoutReference(row: { ambassador_last_name?: string | null; full_name?: string | null; email?: string | null }, now: Date): string {
  const name = row.ambassador_last_name || row.full_name || row.email || '';
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `Commission ambassadeur ${name} ${month}`.replace(/\s+/g, ' ').trim();
}

export const COMMISSION_STATUS_LABELS: Record<AmbassadorCommissionStatus, string> = {
  CONFIRMED: 'À verser',
  PAID: 'Versée',
  CANCELLED: 'Annulée',
};

export const payoutRequestSchema = z.object({
  ambassadorId: z.string().uuid(),
  commissionIds: z.array(z.string().uuid()).min(1).max(500),
  paymentNote: z.string().trim().max(200).optional(),
}).strict();

export const CANCEL_REASON_MIN = 3;
export const CANCEL_NOTE_PREFIX = 'Annulée : ';

export const cancelRequestSchema = z.object({
  reason: z.string().trim().min(CANCEL_REASON_MIN).max(300),
}).strict();
