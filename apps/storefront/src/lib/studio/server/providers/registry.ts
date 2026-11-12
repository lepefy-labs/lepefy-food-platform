import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { geminiImageProvider } from './gemini';
import { openaiImageProvider } from './openai';
import {
  StudioProviderError,
  type ImageStudioProvider,
  type StudioCapability,
  type StudioImageRequest,
  type StudioImageResult,
  type StudioModelRef,
} from './types';

/**
 * Candidates of an AI Core routing policy `studio/<capability>`, in priority
 * order (enabled policy, model and provider only). Image models are separate
 * from Nala's: they have no `chat` capability, the chat router ignores them.
 */
const ADAPTERS: Record<string, ImageStudioProvider> = {
  gemini: geminiImageProvider,
  openai: openaiImageProvider,
};

export interface StudioCandidate extends StudioModelRef {
  credentialRef: string | null;
  priority: number;
}

interface PolicyModelRow {
  priority: number;
  enabled: boolean;
  ai_models: {
    key: string; provider_model_id: string; enabled: boolean; capabilities: Record<string, boolean> | null;
    ai_providers: { key: string; provider_type: string; enabled: boolean; credential_ref: string | null; base_url: string | null } | null;
  } | null;
}

export async function studioCandidates(db: SupabaseClient, capability: StudioCapability): Promise<StudioCandidate[]> {
  const { data: policy, error } = await db.from('ai_routing_policies').select('id, enabled')
    .eq('consumer', 'studio').eq('capability', capability).maybeSingle();
  if (error || !policy || policy.enabled === false) return [];
  const { data: rows } = await db.from('ai_routing_policy_models')
    .select('priority, enabled, ai_models(key, provider_model_id, enabled, capabilities, ai_providers(key, provider_type, enabled, credential_ref, base_url))')
    .eq('policy_id', policy.id);
  const capabilityFlag = capability === 'photo_edit' ? 'image_edit' : 'image_generation';
  return ((rows ?? []) as unknown as PolicyModelRow[])
    .filter((row) => row.enabled && row.ai_models?.enabled && row.ai_models.ai_providers?.enabled
      && row.ai_models.capabilities?.[capabilityFlag] === true)
    .sort((a, b) => a.priority - b.priority)
    .map((row) => ({
      key: row.ai_models!.key,
      providerModelId: row.ai_models!.provider_model_id,
      providerKey: row.ai_models!.ai_providers!.key,
      providerType: row.ai_models!.ai_providers!.provider_type,
      baseUrl: row.ai_models!.ai_providers!.base_url,
      credentialRef: row.ai_models!.ai_providers!.credential_ref,
      priority: row.priority,
    }));
}

export interface StudioRunResult extends StudioImageResult {
  model: StudioCandidate;
  latencyMs: number;
  attempts: Array<{ model: string; code: string }>;
}

/**
 * Tries the candidates in order. A timeout or a refusal of the content stops
 * the chain (another model would cost again for the same refusal); a missing
 * key, an unavailable model or a provider error moves to the next one.
 */
export async function runStudioImage(
  candidates: StudioCandidate[],
  request: Omit<StudioImageRequest, 'signal'>,
  options: { timeoutMs: number; credential?: (ref: string) => string | undefined; adapters?: Record<string, ImageStudioProvider> },
): Promise<StudioRunResult> {
  const attempts: Array<{ model: string; code: string }> = [];
  const readCredential = options.credential ?? ((ref: string) => process.env[ref]);
  const adapters = options.adapters ?? ADAPTERS;
  if (candidates.length === 0) throw new StudioProviderError('no_enabled_model');
  let lastError: StudioProviderError = new StudioProviderError('no_enabled_model');
  for (const candidate of candidates) {
    const adapter = adapters[candidate.providerType];
    const credential = candidate.credentialRef ? readCredential(candidate.credentialRef) : undefined;
    if (!adapter) { attempts.push({ model: candidate.key, code: 'model_unavailable' }); lastError = new StudioProviderError('model_unavailable'); continue; }
    if (!credential) { attempts.push({ model: candidate.key, code: 'missing_credential' }); lastError = new StudioProviderError('missing_credential'); continue; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const start = Date.now();
    try {
      const result = await adapter.run({ ...request, signal: controller.signal }, candidate, credential);
      return { ...result, model: candidate, latencyMs: Date.now() - start, attempts };
    } catch (error) {
      const failure = error instanceof StudioProviderError ? error : new StudioProviderError(controller.signal.aborted ? 'provider_timeout' : 'provider_error');
      attempts.push({ model: candidate.key, code: failure.code });
      lastError = failure;
      if (failure.code === 'provider_timeout' || failure.code === 'safety_blocked') break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw Object.assign(lastError, { attempts });
}

/** Cost of one call from ai_pricing: flat price per image when set, else tokens. */
export async function studioCallCostUsd(
  db: SupabaseClient,
  providerType: string,
  providerModelId: string,
  usage: { inputTokens?: number; outputTokens?: number; images?: number },
): Promise<number> {
  const { data } = await db.from('ai_pricing')
    .select('input_price_per_million, output_price_per_million, image_price_flat')
    .eq('provider', providerType).eq('model', providerModelId).eq('active', true).maybeSingle();
  return computeStudioCost(data as PricingRow | null, usage);
}

export interface PricingRow {
  input_price_per_million: number | string | null;
  output_price_per_million: number | string | null;
  image_price_flat: number | string | null;
}

export function computeStudioCost(pricing: PricingRow | null, usage: { inputTokens?: number; outputTokens?: number; images?: number }): number {
  if (!pricing) return 0;
  const input = Number(pricing.input_price_per_million ?? 0) * (usage.inputTokens ?? 0) / 1_000_000;
  const flat = pricing.image_price_flat == null ? null : Number(pricing.image_price_flat);
  const output = flat != null
    ? flat * (usage.images ?? 1)
    : Number(pricing.output_price_per_million ?? 0) * (usage.outputTokens ?? 0) / 1_000_000;
  return Math.round((input + output) * 10_000) / 10_000;
}
