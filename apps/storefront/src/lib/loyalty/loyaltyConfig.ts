import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readModuleConfig, type ModuleConfigDefinition, type ModuleConfigState } from '@/lib/tenantConfig/moduleConfig';

/**
 * Loyalty program settings: the single source of truth is tenant_feature_settings
 * (feature_key 'loyalty', migration 130); the legacy tenants columns are dropped
 * by migration 131. Keys and ranges mirror public.is_valid_loyalty_config().
 */
export const LOYALTY_FEATURE_KEY = 'loyalty';

// numeric(10,4) of the former columns: 0 … 999999.9999, at most 4 decimals.
const rate = z.number().min(0).max(999999.9999)
  .refine((value) => Number(value.toFixed(4)) === value, 'Au plus 4 décimales');

export const loyaltyConfigSchema = z.object({
  version: z.literal(1),
  purchase_points_rate: rate,
  points_to_currency_rate: rate,
});

export type LoyaltyConfig = z.infer<typeof loyaltyConfigSchema>;

/** Same defaults as the former columns (migration 040). */
export const LOYALTY_DEFAULTS: LoyaltyConfig = {
  version: 1,
  purchase_points_rate: 1,
  points_to_currency_rate: 0.01,
};

export const loyaltyModule: ModuleConfigDefinition<LoyaltyConfig> = {
  featureKey: LOYALTY_FEATURE_KEY,
  schema: loyaltyConfigSchema,
  defaults: LOYALTY_DEFAULTS,
};

/** Admin PATCH body: every field optional, unknown fields rejected. */
export const loyaltyPatchSchema = z.object({
  enabled: z.boolean().optional(),
  config: loyaltyConfigSchema.omit({ version: true }).partial().strict().optional(),
}).strict();

export interface LoyaltySettings {
  enabled: boolean;
  purchasePointsRate: number;
  pointsToCurrencyRate: number;
}

const DISABLED: LoyaltySettings = {
  enabled: false,
  purchasePointsRate: LOYALTY_DEFAULTS.purchase_points_rate,
  pointsToCurrencyRate: LOYALTY_DEFAULTS.points_to_currency_rate,
};

/**
 * Pure: a valid row is used as stored; a missing row (e.g. a tenant created
 * after 131) means the program is off; an invalid or unreadable row suspends
 * the program instead of awarding points at a guessed rate.
 */
export function resolveLoyaltySettings(state: ModuleConfigState<LoyaltyConfig> | null): LoyaltySettings {
  if (!state || state.status !== 'ok') return DISABLED;
  return {
    enabled: state.enabled,
    purchasePointsRate: state.config.purchase_points_rate,
    pointsToCurrencyRate: state.config.points_to_currency_rate,
  };
}

/** Tenant-scoped read for server code. Never throws: failures disable the program. */
export async function getLoyaltySettings(db: SupabaseClient, tenantId: string): Promise<LoyaltySettings> {
  let state: ModuleConfigState<LoyaltyConfig> | null = null;
  try {
    state = await readModuleConfig(db, loyaltyModule, tenantId);
    if (state.status === 'invalid') console.error('[loyalty] invalid settings, program suspended', tenantId, state.issues);
  } catch (error) {
    console.error('[loyalty] settings unavailable, program suspended for this request', tenantId, error);
  }
  return resolveLoyaltySettings(state);
}
