export type AiProductFeatureKey =
  | 'shopping_assistant'
  | 'smart_search'
  | 'product_descriptions'
  | 'product_images'
  | 'catalog_indexing'
  | 'knowledge_base'
  | 'other';

export interface AiProductFeatureDefinition {
  key: AiProductFeatureKey;
  label: string;
  description: string;
  unitLabelSingular: string;
  unitLabelPlural: string;
  creditWeight: number;
  sortOrder: number;
}

export interface AiRawUsageRow {
  endpoint: string;
  total_calls: number | string;
}

export interface AiTenantUsageFeature extends AiProductFeatureDefinition {
  usageCount: number;
  creditsConsumed: number;
}

export const AI_PRODUCT_FEATURES: Record<AiProductFeatureKey, AiProductFeatureDefinition> = {
  shopping_assistant: {
    key: 'shopping_assistant',
    label: 'Nala — Assistant shopping',
    description: 'Interactions avec l’assistant shopping.',
    unitLabelSingular: 'interaction',
    unitLabelPlural: 'interactions',
    creditWeight: 1,
    sortOrder: 10,
  },
  smart_search: {
    key: 'smart_search',
    label: 'Recherche intelligente',
    description: 'Recherches sémantiques dans le catalogue.',
    unitLabelSingular: 'recherche',
    unitLabelPlural: 'recherches',
    creditWeight: 1,
    sortOrder: 20,
  },
  product_descriptions: {
    key: 'product_descriptions',
    label: 'Descriptions produits',
    description: 'Descriptions produit générées ou améliorées par IA.',
    unitLabelSingular: 'génération',
    unitLabelPlural: 'générations',
    creditWeight: 1,
    sortOrder: 30,
  },
  product_images: {
    key: 'product_images',
    label: 'Images produits',
    description: 'Images produit générées par IA.',
    unitLabelSingular: 'génération',
    unitLabelPlural: 'générations',
    creditWeight: 1,
    sortOrder: 40,
  },
  catalog_indexing: {
    key: 'catalog_indexing',
    label: 'Indexation catalogue',
    description: 'Mises à jour de l’index intelligent du catalogue.',
    unitLabelSingular: 'opération',
    unitLabelPlural: 'opérations',
    creditWeight: 1,
    sortOrder: 50,
  },
  knowledge_base: {
    key: 'knowledge_base',
    label: 'Base de connaissance IA',
    description: 'Traitements liés à la connaissance utilisée par l’assistant.',
    unitLabelSingular: 'opération',
    unitLabelPlural: 'opérations',
    creditWeight: 1,
    sortOrder: 60,
  },
  other: {
    key: 'other',
    label: 'Autres usages IA',
    description: 'Autres fonctionnalités IA incluses dans la plateforme.',
    unitLabelSingular: 'utilisation',
    unitLabelPlural: 'utilisations',
    creditWeight: 1,
    sortOrder: 90,
  },
};

const ENDPOINT_FEATURE_MAP: Record<string, AiProductFeatureKey> = {
  chatbox: 'shopping_assistant',
  'search-semantic': 'smart_search',
  'generate-product-description': 'product_descriptions',
  'generate-product-image': 'product_images',
  'embed-sync': 'catalog_indexing',
  'knowledge-base': 'knowledge_base',
  'knowledge-base-sync': 'knowledge_base',
};

export function featureForAiEndpoint(endpoint: string): AiProductFeatureDefinition {
  return AI_PRODUCT_FEATURES[ENDPOINT_FEATURE_MAP[endpoint] ?? 'other'];
}

export function aggregateTenantAiUsage(rows: AiRawUsageRow[]): AiTenantUsageFeature[] {
  const totals = new Map<AiProductFeatureKey, number>();

  for (const row of rows) {
    const feature = featureForAiEndpoint(row.endpoint);
    const count = Number(row.total_calls) || 0;
    totals.set(feature.key, (totals.get(feature.key) ?? 0) + count);
  }

  return Array.from(totals.entries())
    .map(([key, usageCount]) => {
      const feature = AI_PRODUCT_FEATURES[key];
      return {
        ...feature,
        usageCount,
        creditsConsumed: usageCount * feature.creditWeight,
      };
    })
    .filter((row) => row.usageCount > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function aiUsageUnitLabel(feature: AiTenantUsageFeature): string {
  return feature.usageCount === 1 ? feature.unitLabelSingular : feature.unitLabelPlural;
}
