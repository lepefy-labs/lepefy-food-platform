import {
  AiAttemptError, AiRoutingError,
  type AiCandidate, type AiRequest, type AiResponse, type AdapterResponse,
  type LepefyAiProviderAdapter, type ProviderType,
} from './types';

export interface AttemptTelemetry {
  candidate: AiCandidate; status: 'success' | 'error' | 'rate_limited';
  latencyMs: number; fallbackUsed: boolean; fallbackReason: string | null;
  inputTokens?: number; outputTokens?: number;
}
export class LocalCircuitBreaker {
  private entries = new Map<string, { failures: number; until: number }>();
  blocked(key: string, now = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.until && entry.until <= now) { this.entries.delete(key); return false; }
    return entry.until > now;
  }
  success(key: string) { this.entries.delete(key); }
  failure(key: string, now = Date.now()) {
    const failures = (this.entries.get(key)?.failures ?? 0) + 1;
    this.entries.set(key, { failures, until: failures >= 5 ? now + 300_000 : 0 });
    if (this.entries.size > 1000) this.entries.delete(this.entries.keys().next().value!);
  }
}
const breaker = new LocalCircuitBreaker();
export function orderCandidates(candidates: AiCandidate[]) {
  return candidates.filter(c => c.enabled && c.model.enabled && c.provider.enabled
    && c.model.capabilities.structured_output === true && c.model.capabilities.chat === true)
    .sort((a, b) => a.priority - b.priority || a.model.key.localeCompare(b.model.key));
}
export async function routeAi<T>(params: {
  candidates: AiCandidate[]; request: AiRequest<T>;
  adapter: (type: ProviderType) => LepefyAiProviderAdapter | undefined;
  credential: (ref: string) => string | undefined;
  telemetry: (event: AttemptTelemetry) => Promise<void>;
  circuit?: LocalCircuitBreaker; budgetMs?: number;
}): Promise<AiResponse<T>> {
  const reasons: string[] = [];
  const circuit = params.circuit ?? breaker;
  const deadline = Date.now() + (params.budgetMs ?? 18_000);
  const candidates = orderCandidates(params.candidates);
  for (const candidate of candidates) {
    const start = Date.now();
    if (start >= deadline) { reasons.push('routing_timeout'); break; }
    let result: AdapterResponse | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const emit = async (status: AttemptTelemetry['status'], reason: string | null) => {
      try {
        await params.telemetry({ candidate, status, latencyMs: Date.now() - start,
          fallbackUsed: reasons.length > 0, fallbackReason: reason,
          inputTokens: result?.inputTokens, outputTokens: result?.outputTokens });
      } catch { /* Telemetry must never select a different model. */ }
    };
    try {
      if (circuit.blocked(candidate.model.id)) throw new AiAttemptError('circuit_open');
      const adapter = params.adapter(candidate.provider.provider_type);
      if (!adapter) throw new AiAttemptError('model_unavailable');
      const ref = candidate.provider.credential_ref;
      const credential = ref ? params.credential(ref) : null;
      if (ref && !credential) throw new AiAttemptError('missing_credential');
      const timeout = Math.min(candidate.timeout_ms, deadline - start);
      result = await Promise.race([
        adapter.generate({ ...params.request, model: candidate.model,
          provider: candidate.provider, credential: credential ?? null, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new AiAttemptError('provider_timeout')); }, timeout);
        }),
      ]);
      let structured: T;
      try {
        if (result.text.length > 32_000) throw new Error('output_too_large');
        structured = params.request.validate(JSON.parse(result.text));
      } catch { throw new AiAttemptError('invalid_structured_output'); }
      const confidence = result.confidence;
      if (confidence !== undefined && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
        && candidate.min_confidence !== null && confidence < candidate.min_confidence) {
        throw new AiAttemptError('low_confidence');
      }
      circuit.success(candidate.model.id);
      await emit('success', reasons.at(-1) ?? null);
      return { ...result, structured, provider: candidate.provider.key,
        model: candidate.model.provider_model_id, latencyMs: Date.now() - start, fallbackUsed: reasons.length > 0 };
    } catch (error) {
      const code = error instanceof AiAttemptError ? error.code : 'provider_error';
      if (!['circuit_open', 'missing_credential', 'model_unavailable'].includes(code)) circuit.failure(candidate.model.id);
      await emit(code === 'rate_limit' ? 'rate_limited' : 'error', code);
      reasons.push(code);
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  throw new AiRoutingError(reasons.length ? reasons : ['no_enabled_model']);
}
