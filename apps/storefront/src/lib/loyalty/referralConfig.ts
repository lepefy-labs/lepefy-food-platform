import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tenant } from '@lepefy/types';
import { readModuleConfig, type ModuleConfigDefinition, type ModuleConfigState } from '@/lib/tenantConfig/moduleConfig';

/**
 * Referral program settings, stored in tenant_feature_settings (feature_key
 * 'referral', migration 132) and mirrored to the legacy tenants.referral_*
 * columns by a two-way trigger until they are dropped. Keys and ranges mirror
 * public.is_valid_referral_config() and the 040 column constraints.
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

/** Same keys as the legacy tenant columns, so readers keep their existing logic. */
export type ReferralSettings = Pick<Tenant,
  | 'referral_max_depth' | 'referral_signup_bonus_points' | 'referral_availability_mode'
  | 'referral_unlock_spending_threshold' | 'referral_fraud_max_conversions'
  | 'referral_fraud_period_days' | 'referral_fraud_action'>;

const LEGACY_COLUMNS = 'referral_max_depth, referral_signup_bonus_points, referral_availability_mode, referral_unlock_spending_threshold, referral_fraud_max_conversions, referral_fraud_period_days, referral_fraud_action';

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

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

/** Legacy tenant columns (PostgREST may return numerics as strings) → settings. */
export function referralSettingsFromLegacy(row: Record<string, unknown>): ReferralSettings {
  return {
    referral_max_depth: Number(row.referral_max_depth),
    referral_signup_bonus_points: Number(row.referral_signup_bonus_points),
    referral_availability_mode: row.referral_availability_mode as ReferralSettings['referral_availability_mode'],
    referral_unlock_spending_threshold: numberOrNull(row.referral_unlock_spending_threshold),
    referral_fraud_max_conversions: Number(row.referral_fraud_max_conversions),
    referral_fraud_period_days: Number(row.referral_fraud_period_days),
    referral_fraud_action: row.referral_fraud_action as ReferralSettings['referral_fraud_action'],
  };
}

/**
 * Pure precedence: a valid enabled row wins; a disabled or invalid row makes
 * the referral program unavailable (null — callers already treat a missing
 * tenant row as "no referral effect"); a missing row means migration 132 is
 * not applied yet, so the caller falls back to the legacy columns.
 */
export function resolveReferralSettings(
  state: ModuleConfigState<ReferralConfig>,
): ReferralSettings | null | 'missing' {
  if (state.status === 'missing') return 'missing';
  if (state.status === 'invalid' || !state.enabled) return null;
  return fromConfig(state.config);
}

/**
 * Tenant-scoped read for server code. Returns null when the program is
 * unavailable for this tenant (disabled/invalid settings or unreadable data).
 */
export async function getReferralSettings(db: SupabaseClient, tenantId: string): Promise<ReferralSettings | null> {
  try {
    const state = await readModuleConfig(db, referralModule, tenantId);
    if (state.status === 'invalid') console.error('[referral] invalid settings, program suspended', tenantId, state.issues);
    const resolved = resolveReferralSettings(state);
    if (resolved !== 'missing') return resolved;
  } catch (error) {
    // Falls through to the legacy columns, kept identical by the 132 triggers.
    console.error('[referral] settings unavailable, using tenant columns', tenantId, error);
  }
  const { data, error } = await db.from('tenants').select(LEGACY_COLUMNS).eq('id', tenantId).maybeSingle();
  if (error || !data) {
    console.error('[referral] legacy settings unavailable', tenantId, error);
    return null;
  }
  return referralSettingsFromLegacy(data as unknown as Record<string, unknown>);
}
