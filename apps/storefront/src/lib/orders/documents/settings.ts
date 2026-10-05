import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isModuleRegistered, readModuleConfig, resolveModuleConfig,
  type ModuleConfigDefinition, type ModuleConfigRow,
} from '@/lib/tenantConfig/moduleConfig';
import { ORDER_DOCUMENT_FORMAT_IDS, DEFAULT_ORDER_DOCUMENT_FORMAT } from './formats';

/**
 * Préférences des documents de commande, une ligne
 * tenant_feature_settings (tenant_id, 'order_documents') — migration 145.
 * Config plate (la fusion de moduleConfig est superficielle) ; clés et types
 * miroirs de public.is_valid_order_documents_config(). `enabled` de la ligne
 * n'a pas de sens ici (les documents sont toujours disponibles) : seule la
 * config compte, et une ligne absente ou invalide vaut les défauts sûrs.
 */
export const ORDER_DOCUMENTS_FEATURE_KEY = 'order_documents';

const formatSchema = z.enum(ORDER_DOCUMENT_FORMAT_IDS);

export const orderDocumentsConfigSchema = z.object({
  version: z.literal(1),
  picking_list_format: formatSchema,
  packing_slip_enabled: z.boolean(),
  packing_slip_format: formatSchema,
  packing_slip_show_logo: z.boolean(),
  packing_slip_show_qr: z.boolean(),
  packing_slip_show_thank_you: z.boolean(),
  packing_slip_show_contact: z.boolean(),
  packing_slip_show_prices: z.boolean(),
  packing_slip_show_delivery_address: z.boolean(),
}).strict();

export type OrderDocumentsConfig = z.infer<typeof orderDocumentsConfigSchema>;

export const ORDER_DOCUMENTS_DEFAULTS: OrderDocumentsConfig = {
  version: 1,
  picking_list_format: DEFAULT_ORDER_DOCUMENT_FORMAT,
  packing_slip_enabled: true,
  packing_slip_format: DEFAULT_ORDER_DOCUMENT_FORMAT,
  packing_slip_show_logo: true,
  packing_slip_show_qr: true,
  packing_slip_show_thank_you: true,
  packing_slip_show_contact: true,
  // Un colis peut être un cadeau : prix et adresse masqués par défaut.
  packing_slip_show_prices: false,
  packing_slip_show_delivery_address: false,
};

export const orderDocumentsModule: ModuleConfigDefinition<OrderDocumentsConfig> = {
  featureKey: ORDER_DOCUMENTS_FEATURE_KEY,
  schema: orderDocumentsConfigSchema,
  defaults: ORDER_DOCUMENTS_DEFAULTS,
};

/** Corps PATCH admin : chaque champ optionnel, champs inconnus refusés. */
export const orderDocumentsPatchSchema = z.object({
  config: orderDocumentsConfigSchema.omit({ version: true }).partial().strict(),
}).strict();

export interface OrderDocumentSettings {
  config: OrderDocumentsConfig;
  /** false : migration 145 absente ou lecture impossible (défauts appliqués, écriture refusée). */
  available: boolean;
  status: 'missing' | 'ok' | 'invalid' | 'unavailable';
}

/** Pur : une ligne invalide ne doit jamais publier de prix ou d'adresse → défauts. */
export function resolveOrderDocumentSettings(row: ModuleConfigRow | null): OrderDocumentSettings {
  const state = resolveModuleConfig(orderDocumentsModule, row);
  return { config: state.config, available: true, status: state.status };
}

/** Lecture tenant-scoped, jamais bloquante pour l'impression. */
export async function readOrderDocumentSettings(db: SupabaseClient, tenantId: string): Promise<OrderDocumentSettings> {
  try {
    if (!(await isModuleRegistered(db, ORDER_DOCUMENTS_FEATURE_KEY))) {
      return { config: ORDER_DOCUMENTS_DEFAULTS, available: false, status: 'unavailable' };
    }
    const state = await readModuleConfig(db, orderDocumentsModule, tenantId);
    return { config: state.config, available: true, status: state.status };
  } catch (error) {
    console.error('[order-documents] settings unavailable', tenantId, error instanceof Error ? error.message : error);
    return { config: ORDER_DOCUMENTS_DEFAULTS, available: false, status: 'unavailable' };
  }
}
