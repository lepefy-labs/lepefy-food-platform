export interface AiPricing {
  id: string;
  provider: string;
  model: string;
  input_price_per_million: number | null;
  output_price_per_million: number | null;
  image_price_flat: number | null;
  currency: string;
  active: boolean;
  updated_at: string;
}

export interface AiUsageLogEntry {
  id: string;
  tenant_id: string;
  endpoint: string;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  images_generated: number;
  estimated_cost_usd: number;
  status: 'success' | 'error' | 'rate_limited';
  created_at: string;
}

export interface AiUsageMonthlyByTenant {
  tenant_id: string;
  month: string;
  provider: string;
  endpoint: string;
  total_calls: number;
  total_cost_usd: number;
}

export type KnowledgeBaseCategory = 'recipe' | 'expression' | 'greeting' | 'cultural_context' | 'faq';

/** Ligne autoritative de tenant_knowledge_base — toujours validée par un humain avant utilisation. */
export interface KnowledgeBaseEntry {
  id: string;
  category: KnowledgeBaseCategory;
  content: string;
  source: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  active: boolean;
  created_at: string;
}

export type KnowledgeSuggestionSignal = 'knowledge_missing' | 'retrieval_weak' | 'retrieval_empty';

/** Brouillon dérivé des signaux Nala, non autoritatif tant qu'un admin tenant ne l'a pas validé. */
export interface KnowledgeBaseSuggestion {
  key: string;
  intent: string;
  category: KnowledgeBaseCategory;
  questionPreview: string;
  proposedContent: string;
  occurrenceCount: number;
  signals: KnowledgeSuggestionSignal[];
  latestAt: string;
}

/** Ligne renvoyée par la funzione SQL match_products (ricerca semantica). */
export interface SemanticMatch {
  id: string;
  name: string;
  slug: string;
  price: number;
  image_url: string | null;
  category_id: string | null;
  category_name: string | null;
  stock: number;
  weight_grams: number | null;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  similarity: number;
}
