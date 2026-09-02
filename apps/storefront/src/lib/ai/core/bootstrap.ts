import type { AiCandidate } from './types';
/** Transitional compatibility only while migration 100 is absent, never for disabled policies. */
export function missingAiSchema(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202';
}
export function bootstrapCandidate(): AiCandidate {
  console.error('[lepefy-ai-core] MIGRATION 100 MISSING: temporary stateless Gemini bootstrap');
  return {
    enabled: true, priority: 1, timeout_ms: 12000, min_confidence: null,
    provider: { id: 'bootstrap', key: 'gemini', name: 'Gemini', provider_type: 'gemini',
      enabled: true, credential_ref: 'GEMINI_API_KEY', base_url: null, config: {}, health_status: 'unknown' },
    model: { id: 'bootstrap', provider_id: 'bootstrap', key: 'gemini-nala-bootstrap',
      provider_model_id: 'gemini-2.5-flash', display_name: 'Gemini Flash (bootstrap)', enabled: true,
      capabilities: { chat: true, structured_output: true }, context_window: null,
      cost_class: null, input_cost_per_million: null, output_cost_per_million: null,
      config: { thinkingBudget: 0 } },
  };
}
