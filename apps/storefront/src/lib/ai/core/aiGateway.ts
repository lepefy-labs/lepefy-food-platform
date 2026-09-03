import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { logAiUsage } from '@/lib/ai/usageTracking';
import { LocalCircuitBreaker, orderCandidates, routeAi, type AttemptTelemetry } from './router';
import {
  AiRoutingError,
  type AiCandidate,
  type AiModel,
  type AiProvider,
  type AiRequest,
  type LepefyAiProviderAdapter,
  type ProviderType,
} from './types';
import { geminiAdapter } from './providers/geminiAdapter';
import { openaiCompatibleAdapter } from './providers/openaiCompatibleAdapter';

const cache = new Map<string, { expires: number; candidates: AiCandidate[] }>();

export function invalidateAiRouting() {
  cache.clear();
}

function adapterFor(type: ProviderType): LepefyAiProviderAdapter | undefined {
  return type === 'gemini'
    ? geminiAdapter
    : type === 'openai_compatible'
      ? openaiCompatibleAdapter
      : undefined;
}

function credentialFor(ref: string): string | undefined {
  return /^[A-Z][A-Z0-9_]*_API_KEY$/.test(ref) ? process.env[ref] : undefined;
}

async function loadCandidates(consumer: string, capability: string): Promise<AiCandidate[]> {
  const key = consumer + ':' + capability;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.candidates;

  const db = createServiceClient();
  const { data: policy, error } = await db.from('ai_routing_policies').select('id')
    .eq('consumer', consumer).eq('capability', capability).eq('enabled', true).maybeSingle();
  if (error) throw new AiRoutingError(['policy_load_failed']);
  if (!policy) throw new AiRoutingError(['policy_unavailable']);

  const results = await Promise.all([
    db.from('ai_routing_policy_models').select('*').eq('policy_id', policy.id),
    db.from('ai_models').select('*').eq('enabled', true),
    db.from('ai_providers').select('*').eq('enabled', true),
  ]);
  if (results.some(result => result.error)) throw new AiRoutingError(['registry_load_failed']);

  const models = (results[1].data ?? []) as AiModel[];
  const providers = (results[2].data ?? []) as AiProvider[];
  const candidates = (results[0].data ?? []).flatMap(row => {
    const model = models.find(item => item.id === row.model_id);
    const provider = providers.find(item => item.id === model?.provider_id);
    return model && provider ? [{ ...row, model, provider } as AiCandidate] : [];
  });

  cache.set(key, { candidates, expires: Date.now() + 30_000 });
  return candidates;
}

async function loadModelCandidate(modelKey: string, capability: string, timeoutMs: number): Promise<AiCandidate> {
  const db = createServiceClient();
  const { data: modelRow, error: modelError } = await db.from('ai_models').select('*')
    .eq('key', modelKey).eq('enabled', true).maybeSingle();
  if (modelError) throw new AiRoutingError(['model_load_failed']);
  if (!modelRow) throw new AiRoutingError(['model_unavailable']);

  const model = modelRow as AiModel;
  if (!model.capabilities?.[capability]) throw new AiRoutingError(['model_capability_unavailable']);

  const { data: providerRow, error: providerError } = await db.from('ai_providers').select('*')
    .eq('id', model.provider_id).eq('enabled', true).maybeSingle();
  if (providerError) throw new AiRoutingError(['provider_load_failed']);
  if (!providerRow) throw new AiRoutingError(['provider_unavailable']);

  const provider = providerRow as AiProvider;
  if (!adapterFor(provider.provider_type)) throw new AiRoutingError(['adapter_unavailable']);
  if (provider.credential_ref && !credentialFor(provider.credential_ref)) {
    throw new AiRoutingError(['credential_unavailable']);
  }

  return {
    model,
    provider,
    enabled: true,
    priority: 1,
    timeout_ms: Math.max(1_000, Math.min(Math.trunc(timeoutMs), 18_000)),
    min_confidence: null,
  };
}

async function recordGatewayTelemetry(params: {
  tenantId: string;
  endpoint: string;
  consumer: string;
  capability: string;
}, event: AttemptTelemetry, updateHealth = true) {
  await logAiUsage({
    tenantId: params.tenantId,
    endpoint: params.endpoint,
    provider: event.candidate.provider.key,
    model: event.candidate.model.provider_model_id,
    status: event.status,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    consumer: params.consumer,
    capability: params.capability,
    latencyMs: event.latencyMs,
    fallbackUsed: event.fallbackUsed,
    fallbackReason: event.fallbackReason,
  });
  if (updateHealth) {
    await createServiceClient().from('ai_providers').update({
      health_status: event.status === 'success' ? 'healthy' : 'degraded',
      last_health_check_at: new Date().toISOString(),
    }).eq('id', event.candidate.provider.id);
  }
}

/**
 * Fail before a batch consumer claims work when its configured AI route cannot run.
 * This protects retry counters from infrastructure/configuration failures such as a
 * missing policy, disabled chain, unsupported adapter, or absent server credential.
 */
export async function assertAiRouteReady(consumer: string, capability: string): Promise<void> {
  let candidates: AiCandidate[];
  try {
    candidates = orderCandidates(await loadCandidates(consumer, capability));
  } catch (error) {
    if (error instanceof AiRoutingError) throw error;
    throw new AiRoutingError(['registry_load_failed']);
  }

  const ready = candidates.some(candidate => {
    if (!adapterFor(candidate.provider.provider_type)) return false;
    const ref = candidate.provider.credential_ref;
    return !ref || Boolean(credentialFor(ref));
  });

  if (!ready) throw new AiRoutingError(['no_ready_model']);
}

export async function runAi<T>(params: {
  tenantId: string;
  endpoint: string;
  consumer: string;
  capability: string;
  request: AiRequest<T>;
}) {
  let candidates: AiCandidate[];
  try {
    candidates = await loadCandidates(params.consumer, params.capability);
  } catch (error) {
    if (error instanceof AiRoutingError) throw error;
    throw new AiRoutingError(['registry_load_failed']);
  }

  return routeAi({
    candidates,
    request: params.request,
    adapter: adapterFor,
    credential: credentialFor,
    telemetry: event => recordGatewayTelemetry(params, event),
  });
}

/**
 * Execute exactly one registered model without changing or consulting a production
 * routing policy. Intended for controlled platform evaluations such as provider
 * benchmarks; callers must use a distinct consumer/endpoint for telemetry.
 */
export async function runAiModel<T>(params: {
  tenantId: string;
  endpoint: string;
  consumer: string;
  capability: string;
  modelKey: string;
  request: AiRequest<T>;
  timeoutMs?: number;
}) {
  const candidate = await loadModelCandidate(params.modelKey, params.capability, params.timeoutMs ?? 10_000);
  return routeAi({
    candidates: [candidate],
    request: params.request,
    adapter: adapterFor,
    credential: credentialFor,
    telemetry: event => recordGatewayTelemetry(params, event, false),
    circuit: new LocalCircuitBreaker(),
  });
}
