export const NALA_INTENTS = [
  'product_search', 'product_information', 'availability', 'price', 'recommendation',
  'substitution', 'recipe', 'delivery', 'store_information', 'event_information',
  'order_help', 'payment_help', 'complaint', 'small_talk', 'other', 'unknown',
] as const;

export const DEMAND_STATUSES = [
  'fulfilled', 'partially_fulfilled', 'unmet', 'not_applicable', 'unknown',
] as const;

export const RETRIEVAL_QUALITIES = [
  'strong', 'weak', 'empty', 'not_applicable', 'unknown',
] as const;

export const KNOWLEDGE_STATUSES = [
  'sufficient', 'missing', 'not_applicable', 'unknown',
] as const;

export type NalaIntent = typeof NALA_INTENTS[number];
export type DemandStatus = typeof DEMAND_STATUSES[number];
export type RetrievalQuality = typeof RETRIEVAL_QUALITIES[number];
export type KnowledgeStatus = typeof KNOWLEDGE_STATUSES[number];

export interface NalaSemanticEnrichment {
  intent: NalaIntent;
  intentConfidence: number | null;
  demandStatus: DemandStatus;
  retrievalQuality: RetrievalQuality;
  knowledgeStatus: KnowledgeStatus;
  requestedProductText: string | null;
}

const PRODUCT_INTENTS = new Set<NalaIntent>([
  'product_search', 'product_information', 'availability', 'price', 'recommendation', 'substitution',
]);

function controlledValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback;
}

export function normalizeNalaSemanticEnrichment(value: unknown): NalaSemanticEnrichment {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const intent = controlledValue(input.intent, NALA_INTENTS, 'unknown');
  const confidence = typeof input.intentConfidence === 'number'
    && Number.isFinite(input.intentConfidence)
    && input.intentConfidence >= 0
    && input.intentConfidence <= 1
    ? input.intentConfidence
    : null;
  const productText = typeof input.requestedProductText === 'string'
    ? input.requestedProductText.replace(/\s+/g, ' ').trim().slice(0, 150)
    : '';

  return {
    intent,
    intentConfidence: confidence,
    demandStatus: controlledValue(input.demandStatus, DEMAND_STATUSES, 'unknown'),
    retrievalQuality: controlledValue(input.retrievalQuality, RETRIEVAL_QUALITIES, 'unknown'),
    knowledgeStatus: controlledValue(input.knowledgeStatus, KNOWLEDGE_STATUSES, 'unknown'),
    requestedProductText: PRODUCT_INTENTS.has(intent) && productText ? productText : null,
  };
}

export function deterministicSmallTalkEnrichment(): NalaSemanticEnrichment {
  return {
    intent: 'small_talk',
    intentConfidence: null,
    demandStatus: 'not_applicable',
    retrievalQuality: 'not_applicable',
    knowledgeStatus: 'not_applicable',
    requestedProductText: null,
  };
}

export function nextEnrichmentFailureStatus(attempts: number): 'pending' | 'failed' {
  return attempts >= 3 ? 'failed' : 'pending';
}
