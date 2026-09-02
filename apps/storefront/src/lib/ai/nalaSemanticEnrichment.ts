import { createServiceClient } from '@/lib/supabase/server';
import { assertAiRouteReady, runAi } from '@/lib/ai/core/aiGateway';
import type { StructuredSchema } from '@/lib/ai/core/types';
import {
  DEMAND_STATUSES,
  deterministicSmallTalkEnrichment,
  KNOWLEDGE_STATUSES,
  NALA_INTENTS,
  nextEnrichmentFailureStatus,
  RETRIEVAL_QUALITIES,
  validateNalaSemanticEnrichment,
  type NalaSemanticEnrichment,
} from '@/lib/ai/nalaSemanticSchema';

const ENDPOINT = 'nala_semantic_enrichment';
const CONSUMER = 'nala_semantic_enrichment';
const CAPABILITY = 'classification';
const VERSION = 'v1';
const MAX_BATCH_SIZE = 25;
const CONCURRENCY = 4;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: [...NALA_INTENTS] },
    intentConfidence: { type: 'number', nullable: true },
    demandStatus: { type: 'string', enum: [...DEMAND_STATUSES] },
    retrievalQuality: { type: 'string', enum: [...RETRIEVAL_QUALITIES] },
    knowledgeStatus: { type: 'string', enum: [...KNOWLEDGE_STATUSES] },
    requestedProductText: { type: 'string', nullable: true },
  },
  required: [
    'intent',
    'intentConfidence',
    'demandStatus',
    'retrievalQuality',
    'knowledgeStatus',
    'requestedProductText',
  ],
} satisfies StructuredSchema;

interface ClaimedInteraction {
  id: string;
  tenant_id: string;
  message_text: string;
  reply_text: string | null;
  outcome: string;
  matched_product_ids: string[] | null;
  matched_kb_ids: string[] | null;
  semantic_enrichment_attempts: number;
}

interface SemanticContext {
  productNames: string[];
  knowledgeEntries: Array<{ category: string; content: string }>;
}

type ErrorCode = 'context_load_error' | 'provider_error' | 'update_error';

async function loadSemanticContext(interaction: ClaimedInteraction): Promise<SemanticContext> {
  const service = createServiceClient();
  const productIds = interaction.matched_product_ids ?? [];
  const knowledgeIds = interaction.matched_kb_ids ?? [];

  const [productsResult, knowledgeResult] = await Promise.all([
    productIds.length
      ? service.from('products').select('name')
        .eq('tenant_id', interaction.tenant_id).in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
    knowledgeIds.length
      ? service.from('tenant_knowledge_base').select('category, content')
        .eq('tenant_id', interaction.tenant_id).in('id', knowledgeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (productsResult.error || knowledgeResult.error) throw new Error('context_load_error');

  return {
    productNames: (productsResult.data ?? []).map(row => String(row.name).slice(0, 150)),
    knowledgeEntries: (knowledgeResult.data ?? []).map(row => ({
      category: String(row.category).slice(0, 50),
      content: String(row.content).slice(0, 600),
    })),
  };
}

function buildSystemPrompt(): string {
  return `Classify one commerce-assistant interaction for aggregate analytics.
Return JSON only and use exactly the allowed taxonomy values.

Rules:
- "unmet" requires clear commercial demand plus evidence that catalog/knowledge did not satisfy it.
- retrieval_empty is not automatically unmet; delivery or store questions can be satisfied by knowledge.
- For outcome rate_limited, classify intent from the message but set response-dependent fields to unknown.
- For outcome error, never infer unmet automatically; use unknown where evidence is insufficient.
- requestedProductText is a short product/category phrase (max 150 characters), never the full message; null for non-product intents.
- intentConfidence must be model-assessed between 0 and 1, or null.
- Do not add prose.

Allowed intents: ${NALA_INTENTS.join(', ')}
Allowed demandStatus: ${DEMAND_STATUSES.join(', ')}
Allowed retrievalQuality: ${RETRIEVAL_QUALITIES.join(', ')}
Allowed knowledgeStatus: ${KNOWLEDGE_STATUSES.join(', ')}`;
}

function buildInteractionPayload(interaction: ClaimedInteraction, context: SemanticContext): string {
  return JSON.stringify({
    message: interaction.message_text,
    reply: interaction.reply_text?.slice(0, 1200) ?? null,
    outcome: interaction.outcome,
    matchedProducts: context.productNames,
    matchedKnowledge: context.knowledgeEntries,
  });
}

async function classifyWithAi(
  interaction: ClaimedInteraction,
  context: SemanticContext,
): Promise<NalaSemanticEnrichment> {
  const response = await runAi<NalaSemanticEnrichment>({
    tenantId: interaction.tenant_id,
    endpoint: ENDPOINT,
    consumer: CONSUMER,
    capability: CAPABILITY,
    request: {
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildInteractionPayload(interaction, context) }],
      responseSchema: RESPONSE_SCHEMA,
      validate: validateNalaSemanticEnrichment,
      temperature: 0,
      maxOutputTokens: 300,
    },
  });

  return response.structured;
}

async function markCompleted(
  interaction: ClaimedInteraction,
  enrichment: NalaSemanticEnrichment,
): Promise<void> {
  const { error } = await createServiceClient().from('nala_interactions').update({
    intent: enrichment.intent,
    intent_confidence: enrichment.intentConfidence,
    demand_status: enrichment.demandStatus,
    retrieval_quality: enrichment.retrievalQuality,
    knowledge_status: enrichment.knowledgeStatus,
    requested_product_text: enrichment.requestedProductText,
    semantic_enriched_at: new Date().toISOString(),
    semantic_enrichment_version: VERSION,
    semantic_enrichment_status: 'completed',
    semantic_enrichment_claimed_at: null,
    semantic_enrichment_last_error_code: null,
  }).eq('id', interaction.id)
    .eq('tenant_id', interaction.tenant_id)
    .eq('semantic_enrichment_status', 'processing');

  if (error) throw new Error('update_error');
}

async function markRetryableFailure(
  interaction: ClaimedInteraction,
  errorCode: ErrorCode,
): Promise<'retry' | 'failed'> {
  const status = nextEnrichmentFailureStatus(interaction.semantic_enrichment_attempts);
  await createServiceClient().from('nala_interactions').update({
    semantic_enrichment_status: status,
    semantic_enrichment_claimed_at: null,
    semantic_enrichment_last_error_code: errorCode,
  }).eq('id', interaction.id)
    .eq('tenant_id', interaction.tenant_id)
    .eq('semantic_enrichment_status', 'processing');

  return status === 'failed' ? 'failed' : 'retry';
}

async function processInteraction(
  interaction: ClaimedInteraction,
): Promise<'completed' | 'retry' | 'failed'> {
  try {
    const enrichment = interaction.outcome === 'small_talk'
      ? deterministicSmallTalkEnrichment()
      : await classifyWithAi(interaction, await loadSemanticContext(interaction));
    await markCompleted(interaction, enrichment);
    return 'completed';
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code: ErrorCode = message === 'context_load_error'
      ? 'context_load_error'
      : message === 'update_error'
        ? 'update_error'
        : 'provider_error';
    console.error('[nala-semantic-enrichment] interaction failed', {
      interactionId: interaction.id,
      errorCode: code,
      attempt: interaction.semantic_enrichment_attempts,
    });
    return markRetryableFailure(interaction, code);
  }
}

export async function processNalaSemanticEnrichmentBatch(batchSize = 20) {
  // Preflight before claim: missing/disabled routing must not consume interaction attempts.
  await assertAiRouteReady(CONSUMER, CAPABILITY);

  const safeBatchSize = Math.max(1, Math.min(Math.trunc(batchSize), MAX_BATCH_SIZE));
  const { data, error } = await createServiceClient().rpc(
    'claim_nala_interactions_for_enrichment',
    { p_batch_size: safeBatchSize },
  );
  if (error) throw new Error('claim_failed');

  const claimed = (data ?? []) as ClaimedInteraction[];
  const summary = { claimed: claimed.length, completed: 0, retry: 0, failed: 0 };
  let cursor = 0;

  async function runWorker() {
    while (cursor < claimed.length) {
      const interaction = claimed[cursor++];
      if (!interaction) return;
      const result = await processInteraction(interaction);
      summary[result] += 1;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, claimed.length) }, () => runWorker()),
  );
  return summary;
}
