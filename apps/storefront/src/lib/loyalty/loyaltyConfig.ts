import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readModuleConfig, type ModuleConfigDefinition, type ModuleConfigState } from '@/lib/tenantConfig/moduleConfig';

/**
 * Loyalty program settings, stored in tenant_feature_settings (feature_key
 * 'loyalty', migration 130) and mirrored to the legacy tenants columns by a
 * two-way trigger. Keys and ranges mirror public.is_valid_loyalty_config().
 */
export const LOYALTY_FEATURE_KEY = 'loyalty';

// numeric(10,4) of the legacy columns: 0 … 999999.9999, at most 4 decimals.
const rate = z.number().min(0).max(999999.9999)
  .refine((value) => Number(value.toFixed(4)) === value, 'Au plus 4 décimales');

export const loyaltyConfigSchema = z.object({
  version: z.literal(1),
  purchase_points_rate: rate,
  points_to_currency_rate: rate,
});

export type LoyaltyConfig = z.infer<typeof loyaltyConfigSchema>;

/** Same defaults as the legacy columns (migration 040). */
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

export interface LegacyLoyaltyColumns {
  loyalty_enabled: boolean;
  purchase_points_rate: number;
  points_to_currency_rate: number;
}

export interface LoyaltySettings {
  enabled: boolean;
  purchasePointsRate: number;
  pointsToCurrencyRate: number;
  /** 'legacy' only while migration 130 is not applied (no settings row yet). */
  source: 'module' | 'legacy';
}

function fromLegacy(legacy: LegacyLoyaltyColumns): LoyaltySettings {
  return {
    enabled: legacy.loyalty_enabled === true,
    purchasePointsRate: Number(legacy.purchase_points_rate),
    pointsToCurrencyRate: Number(legacy.points_to_currency_rate),
    source: 'legacy',
  };
}

/**
 * Pure precedence: a valid settings row wins; a missing row (or an unreadable
 * one) falls back to the mirrored legacy columns; an invalid row disables the
 * program instead of awarding points at a guessed rate.
 */
export function resolveLoyaltySettings(
  state: ModuleConfigState<LoyaltyConfig> | null,
  legacy: LegacyLoyaltyColumns,
): LoyaltySettings {
  if (!state || state.status === 'missing') return fromLegacy(legacy);
  if (state.status === 'invalid') {
    return { enabled: false, purchasePointsRate: 0, pointsToCurrencyRate: 0, source: 'module' };
  }
  return {
    enabled: state.enabled,
    purchasePointsRate: state.config.purchase_points_rate,
    pointsToCurrencyRate: state.config.points_to_currency_rate,
    source: 'module',
  };
}

/** Tenant-scoped read for server code; `legacy` is the tenants row already loaded. */
export async function getLoyaltySettings(
  db: SupabaseClient,
  tenantId: string,
  legacy: LegacyLoyaltyColumns,
): Promise<LoyaltySettings> {
  let state: ModuleConfigState<LoyaltyConfig> | null = null;
  try {
    state = await readModuleConfig(db, loyaltyModule, tenantId);
    if (state.status === 'invalid') console.error('[loyalty] invalid settings, program suspended', tenantId, state.issues);
  } catch (error) {
    // The legacy columns are kept identical by the migration 130 triggers.
    console.error('[loyalty] settings unavailable, using mirrored tenant columns', tenantId, error);
  }
  return resolveLoyaltySettings(state, legacy);
}
