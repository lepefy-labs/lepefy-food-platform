import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { readModuleConfig, type ModuleConfigDefinition, type ModuleConfigState } from '@/lib/tenantConfig/moduleConfig';
import {
  DIGITAL_CARD_DEFAULTS, DIGITAL_CARD_FEATURE_KEY, digitalCardConfigSchema, resolveCardHeroImage,
  type CardHeroImage, type DigitalCardConfig,
} from './cardHero';
import { hasAnyOpening, type OpeningHours } from './openingHours';

export const digitalCardModule: ModuleConfigDefinition<DigitalCardConfig> = {
  featureKey: DIGITAL_CARD_FEATURE_KEY,
  schema: digitalCardConfigSchema,
  defaults: DIGITAL_CARD_DEFAULTS,
};

/** Réglages lus pour l'admin (état complet, y compris une ligne invalide). */
export function readDigitalCardSettings(db: SupabaseClient, tenantId: string): Promise<ModuleConfigState<DigitalCardConfig>> {
  return readModuleConfig(db, digitalCardModule, tenantId);
}

export interface CardPublicSettings {
  heroImage: CardHeroImage | null;
  /** Null tant qu'aucun jour n'a de plage : /card garde alors les horaires texte. */
  openingHours: OpeningHours | null;
}

/**
 * Réglages publics de /card. Seule la `config` compte (préférence
 * d'affichage) ; une ligne absente, invalide ou illisible retombe sur l'asset
 * du tenant (ou le dégradé) et sur les horaires texte.
 */
export async function getCardPublicSettings(tenant: { id: string; slug: string }): Promise<CardPublicSettings> {
  let config: DigitalCardConfig | null = null;
  try {
    const state = await readDigitalCardSettings(createServiceClient(), tenant.id);
    if (state.status === 'ok') config = state.config;
  } catch (error) {
    console.warn('[card] settings unavailable:', error instanceof Error ? error.message : error);
  }
  return {
    heroImage: resolveCardHeroImage({ slug: tenant.slug, config, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL }),
    openingHours: hasAnyOpening(config?.opening_hours) ? config!.opening_hours : null,
  };
}
