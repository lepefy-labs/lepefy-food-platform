import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isModuleRegistered, readModuleConfig, resolveModuleConfig,
  type ModuleConfigDefinition, type ModuleConfigRow,
} from '@/lib/tenantConfig/moduleConfig';
import { PREPARATION_MODES, DIGITAL_PREPARATION, type OrderPreparationMode } from './preparationPolicy';

/**
 * Mode de confirmation de la préparation, une ligne
 * tenant_feature_settings (tenant_id, 'order_preparation') — migration 160.
 * Clés miroirs de public.is_valid_order_preparation_config(). Ligne absente,
 * invalide ou migration absente = digital / digital (comportement historique) :
 * on ne relâche jamais un contrôle par défaut.
 */
export const ORDER_PREPARATION_FEATURE_KEY = 'order_preparation';

const modeSchema = z.enum(PREPARATION_MODES);

export const orderPreparationConfigSchema = z.object({
  version: z.literal(1),
  picking_mode: modeSchema,
  cold_chain_packing_mode: modeSchema,
}).strict();

export type OrderPreparationConfig = z.infer<typeof orderPreparationConfigSchema>;

export const ORDER_PREPARATION_DEFAULTS: OrderPreparationConfig = {
  version: 1,
  picking_mode: 'digital',
  cold_chain_packing_mode: 'digital',
};

export const orderPreparationModule: ModuleConfigDefinition<OrderPreparationConfig> = {
  featureKey: ORDER_PREPARATION_FEATURE_KEY,
  schema: orderPreparationConfigSchema,
  defaults: ORDER_PREPARATION_DEFAULTS,
};

export const orderPreparationPatchSchema = z.object({
  config: orderPreparationConfigSchema.omit({ version: true }).partial().strict(),
}).strict();

export interface OrderPreparationSettings {
  config: OrderPreparationConfig;
  /** false : migration 160 absente ou lecture impossible (défauts, écriture refusée). */
  available: boolean;
  status: 'missing' | 'ok' | 'invalid' | 'unavailable';
}

export function toPreparationMode(config: Pick<OrderPreparationConfig, 'picking_mode' | 'cold_chain_packing_mode'>): OrderPreparationMode {
  return { picking: config.picking_mode, cold_chain_packing: config.cold_chain_packing_mode };
}

export function resolveOrderPreparationSettings(row: ModuleConfigRow | null): OrderPreparationSettings {
  const state = resolveModuleConfig(orderPreparationModule, row);
  return { config: state.config, available: true, status: state.status };
}

/** Lecture tenant-scoped ; toute erreur retombe sur le mode numérique (le plus strict). */
export async function readOrderPreparationSettings(db: SupabaseClient, tenantId: string): Promise<OrderPreparationSettings> {
  try {
    if (!(await isModuleRegistered(db, ORDER_PREPARATION_FEATURE_KEY))) {
      return { config: ORDER_PREPARATION_DEFAULTS, available: false, status: 'unavailable' };
    }
    const state = await readModuleConfig(db, orderPreparationModule, tenantId);
    return { config: state.config, available: true, status: state.status };
  } catch (error) {
    console.error('[order-preparation] settings unavailable', tenantId, error instanceof Error ? error.message : error);
    return { config: ORDER_PREPARATION_DEFAULTS, available: false, status: 'unavailable' };
  }
}

/** Mode courant du tenant sous forme de snapshot (digital si indisponible). */
export async function readTenantPreparationMode(db: SupabaseClient, tenantId: string): Promise<OrderPreparationMode> {
  const settings = await readOrderPreparationSettings(db, tenantId);
  return settings.available ? toPreparationMode(settings.config) : DIGITAL_PREPARATION;
}
