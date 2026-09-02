export type ProviderType = 'lepefy' | 'gemini' | 'openai' | 'anthropic' | 'openai_compatible';
export interface AiProvider {
  id: string; key: string; name: string; provider_type: ProviderType;
  enabled: boolean; credential_ref: string | null; base_url: string | null;
  config: Record<string, unknown>; health_status: string;
}
export interface AiModel {
  id: string; provider_id: string; key: string; provider_model_id: string;
  display_name: string; enabled: boolean; capabilities: Record<string, boolean>;
  context_window: number | null; cost_class: string | null;
  input_cost_per_million: number | null; output_cost_per_million: number | null;
  config: Record<string, unknown>;
}
export interface AiCandidate {
  model: AiModel; provider: AiProvider; priority: number;
  timeout_ms: number; min_confidence: number | null; enabled: boolean;
}
export interface AiMessage { role: 'user' | 'assistant'; content: string }
export interface StructuredSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  nullable?: boolean; properties?: Record<string, StructuredSchema>;
  items?: StructuredSchema; required?: string[]; enum?: string[];
}
export interface AiRequest<T> {
  system: string; messages: AiMessage[]; responseSchema: StructuredSchema;
  validate: (value: unknown) => T; temperature?: number; maxOutputTokens?: number;
}
export interface AdapterRequest<T> extends AiRequest<T> {
  model: AiModel; provider: AiProvider; credential: string | null; signal: AbortSignal;
}
export interface AdapterResponse {
  text: string; inputTokens?: number; outputTokens?: number;
  /** Only calibrated adapter confidence. Never inferred from generated JSON. */
  confidence?: number;
}
export interface LepefyAiProviderAdapter {
  generate<T>(request: AdapterRequest<T>): Promise<AdapterResponse>;
}
export interface AiResponse<T> extends AdapterResponse {
  structured: T; provider: string; model: string; latencyMs: number; fallbackUsed: boolean;
}
export class AiAttemptError extends Error {
  constructor(public code: string) { super(code); this.name = 'AiAttemptError'; }
}
export class AiRoutingError extends Error {
  constructor(public reasons: string[]) { super('ai_routing_failed'); this.name = 'AiRoutingError'; }
}
