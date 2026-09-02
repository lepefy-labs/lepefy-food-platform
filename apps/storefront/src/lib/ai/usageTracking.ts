import { createServiceClient } from '@/lib/supabase/server';

/**
 * Verifica il rate limit AI per tenant/endpoint tramite la funzione SQL
 * check_ai_rate_limit (finestra 1 minuto per le route pubbliche, 1 giorno
 * per tutte). Server-only: usa il service client per bypassare RLS.
 */
export async function checkRateLimit(
  tenantId: string,
  endpoint: string,
  isPublic: boolean,
): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('check_ai_rate_limit', {
    p_tenant_id: tenantId,
    p_endpoint:  endpoint,
    p_is_public: isPublic,
  });

  if (error) {
    console.error('[ai-usage-tracking] Erreur check_ai_rate_limit:', error.message);
    // Best-effort: en cas d'erreur infra sur le check lui-même, on n'empêche
    // pas la requête (le rate limit est une protection, pas le cœur du service).
    return true;
  }

  return Boolean(data);
}

export interface LogAiUsageParams {
  tenantId: string;
  endpoint: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  imagesGenerated?: number;
  consumer?: string;
  capability?: string;
  latencyMs?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  status: 'success' | 'error' | 'rate_limited';
}

/**
 * Enregistre une ligne d'usage AI et calcule son coût estimé à partir du
 * tarif courant (ai_pricing). Best-effort : ne doit jamais faire échouer
 * l'appelant — toute erreur est loguée avec le préfixe [ai-usage-tracking].
 */
export async function logAiUsage(params: LogAiUsageParams): Promise<void> {
  const {
    tenantId,
    endpoint,
    provider,
    model,
    inputTokens,
    outputTokens,
    imagesGenerated = 0,
    status,
  } = params;

  try {
    const supabase = createServiceClient();

    const { data: pricing, error: pricingError } = await supabase
      .from('ai_pricing')
      .select('input_price_per_million, output_price_per_million, image_price_flat')
      .eq('provider', provider)
      .eq('model', model)
      .eq('active', true)
      .maybeSingle();

    if (pricingError) {
      console.error('[ai-usage-tracking] Erreur lecture ai_pricing:', pricingError.message);
    }

    const inputCost  = pricing?.input_price_per_million && inputTokens
      ? (inputTokens / 1_000_000) * pricing.input_price_per_million
      : 0;
    const outputCost = pricing?.output_price_per_million && outputTokens
      ? (outputTokens / 1_000_000) * pricing.output_price_per_million
      : 0;
    const imageCost  = pricing?.image_price_flat && imagesGenerated
      ? imagesGenerated * pricing.image_price_flat
      : 0;

    const estimatedCostUsd = inputCost + outputCost + imageCost;

    const { error: insertError } = await supabase.from('ai_usage_log').insert({
      ...(params.consumer ? { consumer: params.consumer, capability: params.capability,
        latency_ms: params.latencyMs, fallback_used: params.fallbackUsed,
        fallback_reason: params.fallbackReason } : {}),
      tenant_id:           tenantId,
      endpoint,
      provider,
      model,
      input_tokens:        inputTokens ?? null,
      output_tokens:       outputTokens ?? null,
      images_generated:    imagesGenerated,
      estimated_cost_usd:  estimatedCostUsd,
      status,
    });

    if (insertError) {
      console.error('[ai-usage-tracking] Erreur insertion ai_usage_log:', insertError.message);
    }
  } catch (err) {
    console.error(
      '[ai-usage-tracking] Échec inattendu du tracking:',
      err instanceof Error ? err.message : err,
    );
  }
}
