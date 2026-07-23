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

/** Ligne de tenant_knowledge_base — contenu toujours écrit par un humain, jamais par l'IA. */
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

/** Ligne renvoyée par la fonction SQL match_products (ricerca semantica). */
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
