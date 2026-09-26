import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readModuleConfig, type ModuleConfigDefinition, type ModuleConfigState } from '@/lib/tenantConfig/moduleConfig';

/**
 * AI capability flags and rate limits, stored in tenant_feature_settings
 * (feature_key 'ai', migration 134) and mirrored to the legacy tenants.ai_*
 * columns by a two-way trigger until they are dropped. The rate limits are
 * enforced by the check_ai_rate_limit RPC (027), which still reads the mirror.
 * Keys and ranges mirror public.is_valid_ai_config().
 */
export const AI_FEATURE_KEY = 'ai';

const limit = z.number().int().min(0).max(1_000_000);

export const aiConfigSchema = z.object({
  version: z.literal(1),
  image_generation: z.boolean(),
  description_generation: z.boolean(),
  semantic_search: z.boolean(),
  rate_limit_public_per_minute: limit,
  rate_limit_public_per_day: limit,
  rate_limit_admin_per_day: limit,
});

export type AiConfig = z.infer<typeof aiConfigSchema>;

/** Same defaults as the legacy columns (migrations 013, 026, 027, 028). */
export const AI_DEFAULTS: AiConfig = {
  version: 1,
  image_generation: false,
  description_generation: false,
  semantic_search: false,
  rate_limit_public_per_minute: 20,
  rate_limit_public_per_day: 500,
  rate_limit_admin_per_day: 200,
};

export const aiModule: ModuleConfigDefinition<AiConfig> = {
  featureKey: AI_FEATURE_KEY,
  schema: aiConfigSchema,
  defaults: AI_DEFAULTS,
};

export interface AiCapabilities {
  imageGeneration: boolean;
  descriptionGeneration: boolean;
  semanticSearch: boolean;
}

/** Every AI capability off: the fail-closed state. */
export const AI_CAPABILITIES_OFF: AiCapabilities = {
  imageGeneration: false,
  descriptionGeneration: false,
  semanticSearch: false,
};

export interface LegacyAiColumns {
  ai_image_generation?: boolean | null;
  ai_description_generation?: boolean | null;
  ai_semantic_search?: boolean | null;
}

function fromLegacy(legacy: LegacyAiColumns): AiCapabilities {
  return {
    imageGeneration: legacy.ai_image_generation === true,
    descriptionGeneration: legacy.ai_description_generation === true,
    semanticSearch: legacy.ai_semantic_search === true,
  };
}

/**
 * Pure precedence: a valid enabled row wins; a missing row (migration 134 not
 * applied) or an unreadable one uses the mirrored legacy columns; a disabled
 * or invalid row turns every capability off.
 */
export function resolveAiCapabilities(
  state: ModuleConfigState<AiConfig> | null,
  legacy: LegacyAiColumns,
): AiCapabilities {
  if (!state || state.status === 'missing') return fromLegacy(legacy);
  if (state.status === 'invalid' || !state.enabled) return AI_CAPABILITIES_OFF;
  return {
    imageGeneration: state.config.image_generation,
    descriptionGeneration: state.config.description_generation,
    semanticSearch: state.config.semantic_search,
  };
}

/** Tenant-scoped read for server code; `legacy` is the tenants row already loaded. */
export async function getAiCapabilities(
  db: SupabaseClient,
  tenantId: string,
  legacy: LegacyAiColumns,
): Promise<AiCapabilities> {
  let state: ModuleConfigState<AiConfig> | null = null;
  try {
    state = await readModuleConfig(db, aiModule, tenantId);
    if (state.status === 'invalid') console.error('[ai settings] invalid settings, AI capabilities off', tenantId, state.issues);
  } catch (error) {
    console.error('[ai settings] settings unavailable, using mirrored tenant columns', tenantId, error);
  }
  return resolveAiCapabilities(state, legacy);
}

const NALA_CONTEXT_MAX = 20_000;

/**
 * Private Nala context (server-only). Migration 134 moves it from
 * tenants.chatbox_extra_context to tenant_feature_settings('nala').config.extra_context;
 * until the key exists (migration not applied) the legacy column is used.
 */
export function resolveNalaExtraContext(config: unknown, legacy: string | null | undefined): string | null {
  if (config && typeof config === 'object' && !Array.isArray(config) && 'extra_context' in config) {
    const value = (config as { extra_context?: unknown }).extra_context;
    return typeof value === 'string' && value.trim() ? value.slice(0, NALA_CONTEXT_MAX) : null;
  }
  return legacy?.trim() ? legacy : null;
}

export async function getNalaExtraContext(
  db: SupabaseClient,
  tenantId: string,
  legacy: string | null | undefined,
): Promise<string | null> {
  const { data, error } = await db
    .from('tenant_feature_settings')
    .select('config')
    .eq('tenant_id', tenantId)
    .eq('feature_key', 'nala')
    .maybeSingle();
  if (error) {
    console.error('[nala] settings unavailable, using mirrored tenant column', tenantId, error);
    return resolveNalaExtraContext(null, legacy);
  }
  return resolveNalaExtraContext(data?.config ?? null, legacy);
}
