import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { runAiModel } from '@/lib/ai/core/aiGateway';
import {
  buildNalaSemanticAiRequest,
  loadNalaSemanticContext,
  type NalaSemanticInteractionInput,
} from '@/lib/ai/nalaSemanticEnrichment';
import type { NalaSemanticEnrichment } from '@/lib/ai/nalaSemanticSchema';

const CONSUMER = 'platform_ai_benchmark';
const CAPABILITY = 'classification';
const ENDPOINT = 'ai_provider_benchmark';
const MAX_SAMPLE_SIZE = 12;
const MAX_MODELS = 3;
const CONCURRENCY = 4;

interface BenchmarkInteraction extends NalaSemanticInteractionInput {
  intent: NalaSemanticEnrichment['intent'];
  demand_status: NalaSemanticEnrichment['demandStatus'];
  retrieval_quality: NalaSemanticEnrichment['retrievalQuality'];
  knowledge_status: NalaSemanticEnrichment['knowledgeStatus'];
  requested_product_text: string | null;
}

interface ModelMetadata {
  key: string;
  input_cost_per_million: number | null;
  output_cost_per_million: number | null;
}

function sameText(a: string | null, b: string | null): boolean {
  const normalize = (value: string | null) => value?.replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr') ?? null;
  return normalize(a) === normalize(b);
}

function percentage(matches: number, total: number): number | null {
  return total > 0 ? Math.round((matches / total) * 10_000) / 100 : null;
}

function estimatedCost(metadata: ModelMetadata | undefined, inputTokens: number, outputTokens: number): number | null {
  if (!metadata || metadata.input_cost_per_million === null || metadata.output_cost_per_million === null) return null;
  return (inputTokens / 1_000_000) * metadata.input_cost_per_million
    + (outputTokens / 1_000_000) * metadata.output_cost_per_million;
}

export async function benchmarkNalaSemanticModels(params: {
  tenantId: string;
  modelKeys: string[];
  sampleSize?: number;
}) {
  const modelKeys = [...new Set(params.modelKeys.map(key => key.trim()).filter(Boolean))].slice(0, MAX_MODELS);
  if (modelKeys.length < 2) throw new Error('benchmark_requires_two_models');

  const sampleSize = Math.max(1, Math.min(Math.trunc(params.sampleSize ?? 8), MAX_SAMPLE_SIZE));
  const service = createServiceClient();
  const [{ data: rows, error: rowsError }, { data: modelRows, error: modelsError }] = await Promise.all([
    service.from('nala_interactions').select(
      'id, tenant_id, message_text, reply_text, outcome, matched_product_ids, matched_kb_ids, intent, demand_status, retrieval_quality, knowledge_status, requested_product_text',
    )
      .eq('tenant_id', params.tenantId)
      .eq('semantic_enrichment_status', 'completed')
      .neq('outcome', 'small_talk')
      .order('semantic_enriched_at', { ascending: false })
      .limit(sampleSize),
    service.from('ai_models').select('key, input_cost_per_million, output_cost_per_million').in('key', modelKeys),
  ]);

  if (rowsError) throw new Error('benchmark_sample_load_failed');
  if (modelsError) throw new Error('benchmark_model_metadata_load_failed');

  const interactions = (rows ?? []) as BenchmarkInteraction[];
  if (!interactions.length) {
    return { generatedAt: new Date().toISOString(), sampleSize: 0, baseline: 'semantic_enrichment_v1', models: [] };
  }

  const metadata = new Map((modelRows ?? []).map(row => [row.key, row as ModelMetadata]));
  const contexts = new Map<string, Awaited<ReturnType<typeof loadNalaSemanticContext>>>();
  await Promise.all(interactions.map(async interaction => {
    contexts.set(interaction.id, await loadNalaSemanticContext(interaction));
  }));

  const results = await Promise.all(modelKeys.map(async modelKey => {
    let succeeded = 0;
    let failed = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalLatencyMs = 0;
    let provider: string | null = null;
    let providerModel: string | null = null;
    let intentMatches = 0;
    let demandMatches = 0;
    let retrievalMatches = 0;
    let knowledgeMatches = 0;
    let productTextMatches = 0;
    let cursor = 0;

    async function worker() {
      while (cursor < interactions.length) {
        const interaction = interactions[cursor++];
        if (!interaction) return;
        try {
          const context = contexts.get(interaction.id);
          if (!context) throw new Error('benchmark_context_missing');
          const response = await runAiModel<NalaSemanticEnrichment>({
            tenantId: params.tenantId,
            endpoint: ENDPOINT,
            consumer: CONSUMER,
            capability: CAPABILITY,
            modelKey,
            request: buildNalaSemanticAiRequest(interaction, context),
          });

          provider = response.provider;
          providerModel = response.model;
          succeeded += 1;
          inputTokens += response.inputTokens ?? 0;
          outputTokens += response.outputTokens ?? 0;
          totalLatencyMs += response.latencyMs;
          intentMatches += Number(response.structured.intent === interaction.intent);
          demandMatches += Number(response.structured.demandStatus === interaction.demand_status);
          retrievalMatches += Number(response.structured.retrievalQuality === interaction.retrieval_quality);
          knowledgeMatches += Number(response.structured.knowledgeStatus === interaction.knowledge_status);
          productTextMatches += Number(sameText(response.structured.requestedProductText, interaction.requested_product_text));
        } catch {
          failed += 1;
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, interactions.length) }, () => worker()));
    const comparedFields = succeeded * 5;
    const totalMatches = intentMatches + demandMatches + retrievalMatches + knowledgeMatches + productTextMatches;
    return {
      modelKey,
      provider,
      providerModel,
      attempted: interactions.length,
      succeeded,
      failed,
      schemaSuccessRatePct: percentage(succeeded, interactions.length),
      agreementPct: {
        overall: percentage(totalMatches, comparedFields),
        intent: percentage(intentMatches, succeeded),
        demandStatus: percentage(demandMatches, succeeded),
        retrievalQuality: percentage(retrievalMatches, succeeded),
        knowledgeStatus: percentage(knowledgeMatches, succeeded),
        requestedProductText: percentage(productTextMatches, succeeded),
      },
      averageLatencyMs: succeeded ? Math.round(totalLatencyMs / succeeded) : null,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimatedCost(metadata.get(modelKey), inputTokens, outputTokens),
    };
  }));

  return {
    generatedAt: new Date().toISOString(),
    sampleSize: interactions.length,
    baseline: 'semantic_enrichment_v1',
    note: 'Agreement compares candidate output with the existing production enrichment; it is not a human-labelled accuracy score.',
    models: results,
  };
}
