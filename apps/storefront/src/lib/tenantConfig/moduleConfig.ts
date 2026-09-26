import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';

/**
 * Typed access to one operational module stored in tenant_feature_settings
 * (one row per tenant_id + feature_key, `enabled` + versioned JSONB `config`).
 *
 * Deliberately small: a module declares its feature key, a zod schema and its
 * defaults; parsing, defaults and partial updates then live here instead of in
 * routes, components and workers. Never store secrets, transactional data or
 * relational lists (recipients…) in `config`.
 *
 * Callers pass a server-side (service-role) client; every query is scoped by
 * tenant_id.
 */
export interface ModuleConfigDefinition<T extends Record<string, unknown>> {
  featureKey: string;
  schema: z.ZodType<T>;
  defaults: T;
}

export type ModuleConfigState<T> =
  /** No row: the module is disabled and shows defaults. */
  | { status: 'missing'; enabled: false; active: false; config: T }
  | { status: 'ok'; enabled: boolean; active: boolean; config: T }
  /** Stored row fails validation: never active, defaults shown for editing. */
  | { status: 'invalid'; enabled: boolean; active: false; config: T; issues: string[] };

export interface ModuleConfigRow {
  enabled: boolean | null;
  config: unknown;
}

export class ModuleConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super('invalid_module_config');
    this.name = 'ModuleConfigValidationError';
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => (issue.path.length ? issue.path.join('.') + ': ' : '') + issue.message);
}

function storedObject(config: unknown): Record<string, unknown> | null {
  return config && typeof config === 'object' && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : null;
}

/** Pure: stored keys override defaults; missing keys fall back to defaults. */
export function resolveModuleConfig<T extends Record<string, unknown>>(
  definition: ModuleConfigDefinition<T>,
  row: ModuleConfigRow | null,
): ModuleConfigState<T> {
  if (!row) return { status: 'missing', enabled: false, active: false, config: definition.defaults };
  const enabled = row.enabled === true;
  const stored = storedObject(row.config ?? {});
  if (!stored) {
    return { status: 'invalid', enabled, active: false, config: definition.defaults, issues: ['config: expected object'] };
  }
  const parsed = definition.schema.safeParse({ ...definition.defaults, ...stored });
  if (!parsed.success) {
    return { status: 'invalid', enabled, active: false, config: definition.defaults, issues: formatIssues(parsed.error) };
  }
  return { status: 'ok', enabled, active: enabled, config: parsed.data };
}

/**
 * Pure: merges a partial patch over the stored config (or defaults) and
 * validates the full result. Throws ModuleConfigValidationError when invalid.
 */
export function mergeModuleConfig<T extends Record<string, unknown>>(
  definition: ModuleConfigDefinition<T>,
  row: ModuleConfigRow | null,
  patch: { enabled?: boolean; config?: Partial<T> },
): { enabled: boolean; config: T } {
  const stored = storedObject(row?.config) ?? {};
  const parsed = definition.schema.safeParse({ ...definition.defaults, ...stored, ...(patch.config ?? {}) });
  if (!parsed.success) throw new ModuleConfigValidationError(formatIssues(parsed.error));
  return { enabled: patch.enabled ?? row?.enabled === true, config: parsed.data };
}

async function readRow(db: SupabaseClient, featureKey: string, tenantId: string): Promise<ModuleConfigRow | null> {
  const { data, error } = await db
    .from('tenant_feature_settings')
    .select('enabled, config')
    .eq('tenant_id', tenantId)
    .eq('feature_key', featureKey)
    .maybeSingle();
  if (error) throw new Error(`Unable to read ${featureKey} settings: ${error.message}`);
  return (data as ModuleConfigRow | null) ?? null;
}

export async function readModuleConfig<T extends Record<string, unknown>>(
  db: SupabaseClient,
  definition: ModuleConfigDefinition<T>,
  tenantId: string,
): Promise<ModuleConfigState<T>> {
  return resolveModuleConfig(definition, await readRow(db, definition.featureKey, tenantId));
}

/**
 * Partial update for one tenant. Only the module's own row is touched, so the
 * settings of other modules (Nala, reviews…) are never rewritten.
 */
export async function updateModuleConfig<T extends Record<string, unknown>>(
  db: SupabaseClient,
  definition: ModuleConfigDefinition<T>,
  tenantId: string,
  patch: { enabled?: boolean; config?: Partial<T> },
): Promise<ModuleConfigState<T>> {
  const current = await readRow(db, definition.featureKey, tenantId);
  const next = mergeModuleConfig(definition, current, patch);
  const { error } = await db.from('tenant_feature_settings').upsert(
    {
      tenant_id: tenantId,
      feature_key: definition.featureKey,
      enabled: next.enabled,
      config: next.config,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,feature_key' },
  );
  if (error) throw new Error(`Unable to update ${definition.featureKey} settings: ${error.message}`);
  return { status: 'ok', enabled: next.enabled, active: next.enabled, config: next.config };
}

/** True once the module's catalog row exists (i.e. its migration was applied). */
export async function isModuleRegistered(db: SupabaseClient, featureKey: string): Promise<boolean> {
  const { data, error } = await db.from('platform_features').select('key').eq('key', featureKey).maybeSingle();
  if (error) throw new Error(`Unable to check ${featureKey} registration: ${error.message}`);
  return Boolean(data);
}
