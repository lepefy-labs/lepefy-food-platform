import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isModuleRegistered, readModuleConfig, resolveModuleConfig,
  type ModuleConfigDefinition, type ModuleConfigRow,
} from '@/lib/tenantConfig/moduleConfig';

/**
 * Création des brouillons d'expédition : une ligne
 * tenant_feature_settings (tenant_id, 'shipping_automation') — migration 151.
 * `enabled` de la ligne = création depuis Lepefy activée ; la config porte le
 * moment de création. Ligne absente, invalide ou illisible = désactivé
 * (aucune création automatique ni manuelle). Clés et valeurs miroirs de
 * public.is_valid_shipping_automation_config() (151, étendue par 152 pour
 * `shipment_content`).
 */
export const SHIPPING_AUTOMATION_FEATURE_KEY = 'shipping_automation';

export const SHIPMENT_CREATION_TRIGGERS = ['order_created', 'preparing', 'manual'] as const;
export type ShipmentCreationTrigger = (typeof SHIPMENT_CREATION_TRIGGERS)[number];

/** Packlink `content` is limited to 60 characters (Draft::getContent). */
export const SHIPMENT_CONTENT_MAX = 60;

export const shippingAutomationConfigSchema = z.object({
  version: z.literal(1),
  create_shipment_trigger: z.enum(SHIPMENT_CREATION_TRIGGERS),
  /** Contenu déclaré au transporteur, identique pour tous les brouillons du tenant. */
  shipment_content: z.string().trim().min(1).max(SHIPMENT_CONTENT_MAX),
}).strict();

export type ShippingAutomationConfig = z.infer<typeof shippingAutomationConfigSchema>;

export const SHIPPING_AUTOMATION_DEFAULTS: ShippingAutomationConfig = {
  version: 1, create_shipment_trigger: 'manual', shipment_content: 'Alimenti Non Deperibili',
};

export const shippingAutomationModule: ModuleConfigDefinition<ShippingAutomationConfig> = {
  featureKey: SHIPPING_AUTOMATION_FEATURE_KEY,
  schema: shippingAutomationConfigSchema,
  defaults: SHIPPING_AUTOMATION_DEFAULTS,
};

/** Corps PATCH admin : champs optionnels, champs inconnus refusés. */
export const shippingAutomationPatchSchema = z.object({
  enabled: z.boolean().optional(),
  config: shippingAutomationConfigSchema.omit({ version: true }).partial().strict().optional(),
}).strict();

export interface ShippingAutomationSettings {
  /** Création de brouillons depuis Lepefy activée (ligne valide et enabled). */
  enabled: boolean;
  trigger: ShipmentCreationTrigger;
  /** Contenu déclaré envoyé au transporteur. */
  content: string;
  /** false : migration 151 absente ou lecture impossible (désactivé, écriture refusée). */
  available: boolean;
  status: 'missing' | 'ok' | 'invalid' | 'unavailable';
}

const UNAVAILABLE: ShippingAutomationSettings = {
  enabled: false, trigger: SHIPPING_AUTOMATION_DEFAULTS.create_shipment_trigger,
  content: SHIPPING_AUTOMATION_DEFAULTS.shipment_content, available: false, status: 'unavailable',
};

/** Pur : une ligne invalide n'active jamais la création. */
export function resolveShippingAutomationSettings(row: ModuleConfigRow | null): ShippingAutomationSettings {
  const state = resolveModuleConfig(shippingAutomationModule, row);
  return toSettings(state);
}

function toSettings(state: ReturnType<typeof resolveModuleConfig<ShippingAutomationConfig>>): ShippingAutomationSettings {
  return {
    enabled: state.active, trigger: state.config.create_shipment_trigger, content: state.config.shipment_content,
    available: true, status: state.status,
  };
}

/** Lecture tenant-scoped, jamais bloquante : erreur = désactivé. */
export async function readShippingAutomationSettings(db: SupabaseClient, tenantId: string): Promise<ShippingAutomationSettings> {
  try {
    if (!(await isModuleRegistered(db, SHIPPING_AUTOMATION_FEATURE_KEY))) return UNAVAILABLE;
    return toSettings(await readModuleConfig(db, shippingAutomationModule, tenantId));
  } catch {
    console.error('[shipping/draft] settings unavailable — tenant_id:', tenantId);
    return UNAVAILABLE;
  }
}
