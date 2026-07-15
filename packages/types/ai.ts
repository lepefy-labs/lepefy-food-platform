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
