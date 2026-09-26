import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferralAvailabilityMode, ReferralFraudAction } from '@lepefy/types';
import { readModuleConfig, type ModuleConfigDefinition, type ModuleConfigState } from '@/lib/tenantConfig/moduleConfig';

/**
 * Referral program settings: the single source of truth is
 * tenant_feature_settings (feature_key 'referral', migration 132); the former
 * tenants.referral_* columns are dropped by migration 133. Keys and ranges
 * mirror public.is_valid_referral_config() and the 040 column constraints.
 */
export const REFERRAL_FEATURE_KEY = 'referral';

export const referralConfigSchema = z.object({
  version: z.literal(1),
  max_depth: z.number().int().min(1).max(5),
  signup_bonus_points: z.number().int().min(0).max(9_999_999),
  availability_mode: z.enum(['ALL_CUSTOMERS', 'SPENDING_THRESHOLD', 'ADMIN_GRANTED_ONLY']),
  unlock_spending_threshold: z.number().min(0).max(99_999_999.99)
    .refine((value) => Number(value.toFixed(2)) === value, 'Au plus 2 décimales')
    .nullable(),
  fraud_max_conversions: z.number().min(0).max(1_000_000),
  fraud_period_days: z.number().int().min(1).max(3650),
  fraud_action: z.enum(['FLAG_FOR_REVIEW', 'AUTO_BLOCK', 'CAP_AT_THRESHOLD']),
});

export type ReferralConfig = z.infer<typeof referralConfigSchema>;

/** Same defaults as the legacy columns (migration 040). */
export const REFERRAL_DEFAULTS: ReferralConfig = {
  version: 1,
  max_depth: 2,
  signup_bonus_points: 0,
  availability_mode: 'ALL_CUSTOMERS',
  unlock_spending_threshold: null,
  fraud_max_conversions: 10,
  fraud_period_days: 30,
  fraud_action: 'FLAG_FOR_REVIEW',
};

export const referralModule: ModuleConfigDefinition<ReferralConfig> = {
  featureKey: REFERRAL_FEATURE_KEY,
  schema: referralConfigSchema,
  defaults: REFERRAL_DEFAULTS,
};

/** Admin PATCH body (the fields exposed in /admin/loyalty), unknown fields rejected. */
export const referralPatchSchema = z.object({
  config: referralConfigSchema.omit({ version: true, signup_bonus_points: true }).partial().strict(),
}).strict();

/** Same keys as the former tenant columns, so readers keep their existing logic. */
export interface ReferralSettings {
  referral_max_depth: number;
  referral_signup_bonus_points: number;
  referral_availability_mode: ReferralAvailabilityMode;
  referral_unlock_spending_threshold: number | null;
  referral_fraud_max_conversions: number;
  referral_fraud_period_days: number;
  referral_fraud_action: ReferralFraudAction;
}

function fromConfig(config: ReferralConfig): ReferralSettings {
  return {
    referral_max_depth: config.max_depth,
    referral_signup_bonus_points: config.signup_bonus_points,
    referral_availability_mode: config.availability_mode,
    referral_unlock_spending_threshold: config.unlock_spending_threshold,
    referral_fraud_max_conversions: config.fraud_max_conversions,
    referral_fraud_period_days: config.fraud_period_days,
    referral_fraud_action: config.fraud_action,
  };
}

/**
 * What customer-facing surfaces show when the program is unavailable: nobody
 * is eligible unless an admin grants access, no bonus, no progress threshold.
 */
export const REFERRAL_UNAVAILABLE_VIEW: ReferralSettings = {
  ...fromConfig(REFERRAL_DEFAULTS),
  referral_availability_mode: 'ADMIN_GRANTED_ONLY',
  referral_signup_bonus_points: 0,
};

/**
 * Pure precedence (the settings row is the only source since migration 133):
 * - valid enabled row → stored values;
 * - missing row (tenant created after 133, never configured) → the 040
 *   defaults, i.e. exactly what a new tenant had with the former columns;
 * - disabled or invalid row → null: the program is unavailable (no code, no
 *   automatic eligibility, no bonus, no referral points).
 */
export function resolveReferralSettings(state: ModuleConfigState<ReferralConfig>): ReferralSettings | null {
  if (state.status === 'missing') return fromConfig(REFERRAL_DEFAULTS);
  if (state.status === 'invalid' || !state.enabled) return null;
  return fromConfig(state.config);
}

/**
 * Tenant-scoped read for server code. Never throws: unreadable settings make
 * the program unavailable for this request (fail closed).
 */
export async function getReferralSettings(db: SupabaseClient, tenantId: string): Promise<ReferralSettings | null> {
  try {
    const state = await readModuleConfig(db, referralModule, tenantId);
    if (state.status === 'invalid') console.error('[referral] invalid settings, program suspended', tenantId, state.issues);
    return resolveReferralSettings(state);
  } catch (error) {
    console.error('[referral] settings unavailable, program suspended for this request', tenantId, error);
    return null;
  }
}
