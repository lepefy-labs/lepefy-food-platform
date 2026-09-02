import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { logAiUsage } from '@/lib/ai/usageTracking';
import { routeAi } from './router';
import { AiRoutingError, type AiCandidate, type AiModel, type AiProvider, type AiRequest } from './types';
import { geminiAdapter } from './providers/geminiAdapter';
import { openaiCompatibleAdapter } from './providers/openaiCompatibleAdapter';

import { bootstrapCandidate, missingAiSchema } from './bootstrap';

const cache = new Map<string, { expires: number; candidates: AiCandidate[] }>();
export function invalidateAiRouting() { cache.clear(); }
async function loadCandidates(consumer: string, capability: string): Promise<AiCandidate[]> {
  const key = consumer + ':' + capability;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.candidates;
  const db = createServiceClient();
  const { data: policy, error } = await db.from('ai_routing_policies').select('id')
    .eq('consumer', consumer).eq('capability', capability).eq('enabled', true).maybeSingle();
  if (missingAiSchema(error) && consumer === 'nala') return [bootstrapCandidate()];
  if (error) throw new AiRoutingError(['policy_load_failed']);
  if (!policy) throw new AiRoutingError(['policy_unavailable']);
  const results = await Promise.all([
    db.from('ai_routing_policy_models').select('*').eq('policy_id', policy.id),
    db.from('ai_models').select('*').eq('enabled', true),
    db.from('ai_providers').select('*').eq('enabled', true),
  ]);
  if (results.some(r => r.error)) throw new AiRoutingError(['registry_load_failed']);
  const models = (results[1].data ?? []) as AiModel[];
  const providers = (results[2].data ?? []) as AiProvider[];
  const candidates = (results[0].data ?? []).flatMap(row => {
    const model = models.find(m => m.id === row.model_id);
    const provider = providers.find(p => p.id === model?.provider_id);
    return model && provider ? [{ ...row, model, provider } as AiCandidate] : [];
  });
  cache.set(key, { candidates, expires: Date.now() + 30_000 });
  return candidates;
}
export async function runAi<T>(params: {
  tenantId: string; endpoint: string; consumer: string; capability: string; request: AiRequest<T>;
}) {
  return routeAi({
    candidates: await loadCandidates(params.consumer, params.capability), request: params.request,
    adapter: type => type === 'gemini' ? geminiAdapter
      : type === 'openai_compatible' ? openaiCompatibleAdapter : undefined,
    credential: ref => /^[A-Z][A-Z0-9_]*_API_KEY$/.test(ref) ? process.env[ref] : undefined,
    telemetry: async event => {
      await logAiUsage({
        tenantId: params.tenantId, endpoint: params.endpoint,
        provider: event.candidate.provider.key, model: event.candidate.model.provider_model_id,
        status: event.status, inputTokens: event.inputTokens, outputTokens: event.outputTokens,
        consumer: event.candidate.provider.id === 'bootstrap' ? undefined : params.consumer,
        capability: params.capability, latencyMs: event.latencyMs,
        fallbackUsed: event.fallbackUsed, fallbackReason: event.fallbackReason,
      });
      if (event.candidate.provider.id === 'bootstrap') return;
      await createServiceClient().from('ai_providers').update({
        health_status: event.status === 'success' ? 'healthy' : 'degraded',
        last_health_check_at: new Date().toISOString(),
      }).eq('id', event.candidate.provider.id);
    },
  });
}
