import { createServiceClient } from '@/lib/supabase/server';
import { readModuleConfig, type ModuleConfigDefinition } from '@/lib/tenantConfig/moduleConfig';
import {
  DIGITAL_CARD_DEFAULTS, DIGITAL_CARD_FEATURE_KEY, digitalCardConfigSchema, resolveCardHeroImage,
  type CardHeroImage, type DigitalCardConfig,
} from './cardHero';

const digitalCardModule: ModuleConfigDefinition<DigitalCardConfig> = {
  featureKey: DIGITAL_CARD_FEATURE_KEY,
  schema: digitalCardConfigSchema,
  defaults: DIGITAL_CARD_DEFAULTS,
};

/**
 * Photo de la hero /card du tenant. Seule la `config` de la ligne compte
 * (préférence d'affichage) : son `enabled` n'est lu par rien d'autre ici et
 * l'accès au module reste piloté par les droits et la suspension. Une ligne
 * absente, invalide ou illisible retombe sur l'asset du tenant ou le dégradé.
 */
export async function getCardHeroImage(tenant: { id: string; slug: string }): Promise<CardHeroImage | null> {
  let config: DigitalCardConfig | null = null;
  try {
    const state = await readModuleConfig(createServiceClient(), digitalCardModule, tenant.id);
    if (state.status === 'ok') config = state.config;
  } catch (error) {
    console.warn('[card] hero settings unavailable:', error instanceof Error ? error.message : error);
  }
  return resolveCardHeroImage({ slug: tenant.slug, config, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });
}
