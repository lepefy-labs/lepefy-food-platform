import { expect, test } from '@playwright/test';
import {
  deterministicSmallTalkEnrichment,
  nextEnrichmentFailureStatus,
  normalizeNalaSemanticEnrichment,
  validateNalaSemanticEnrichment,
} from '@/lib/ai/nalaSemanticSchema';

test('normalizes a fulfilled product search', () => {
  expect(normalizeNalaSemanticEnrichment({
    intent: 'product_search',
    intentConfidence: 0.96,
    demandStatus: 'fulfilled',
    retrievalQuality: 'strong',
    knowledgeStatus: 'not_applicable',
    requestedProductText: 'ndolé',
  })).toEqual({
    intent: 'product_search',
    intentConfidence: 0.96,
    demandStatus: 'fulfilled',
    retrievalQuality: 'strong',
    knowledgeStatus: 'not_applicable',
    requestedProductText: 'ndolé',
  });
});

test('keeps unmet product demand as a short derived phrase', () => {
  const result = normalizeNalaSemanticEnrichment({
    intent: 'product_search',
    intentConfidence: 0.91,
    demandStatus: 'unmet',
    retrievalQuality: 'empty',
    knowledgeStatus: 'not_applicable',
    requestedProductText: '  feuilles   de manioc  ',
  });
  expect(result.requestedProductText).toBe('feuilles de manioc');
  expect(result.demandStatus).toBe('unmet');
});

test('drops requested product text for delivery questions', () => {
  const result = normalizeNalaSemanticEnrichment({
    intent: 'delivery',
    intentConfidence: 0.9,
    demandStatus: 'fulfilled',
    retrievalQuality: 'not_applicable',
    knowledgeStatus: 'sufficient',
    requestedProductText: 'Paris',
  });
  expect(result.intent).toBe('delivery');
  expect(result.requestedProductText).toBeNull();
});

test('small talk is deterministic and does not need model confidence', () => {
  expect(deterministicSmallTalkEnrichment()).toEqual({
    intent: 'small_talk',
    intentConfidence: null,
    demandStatus: 'not_applicable',
    retrievalQuality: 'not_applicable',
    knowledgeStatus: 'not_applicable',
    requestedProductText: null,
  });
});

test('invalid classifier output falls back to controlled values only', () => {
  expect(normalizeNalaSemanticEnrichment({
    intent: 'made_up_intent',
    intentConfidence: 42,
    demandStatus: 'definitely',
    retrievalQuality: { unsafe: true },
    knowledgeStatus: 'invented',
    requestedProductText: 'must not survive',
  })).toEqual({
    intent: 'unknown',
    intentConfidence: null,
    demandStatus: 'unknown',
    retrievalQuality: 'unknown',
    knowledgeStatus: 'unknown',
    requestedProductText: null,
  });
});

test('strict AI Core validator accepts valid structured output', () => {
  expect(validateNalaSemanticEnrichment({
    intent: 'recommendation',
    intentConfidence: 0.83,
    demandStatus: 'fulfilled',
    retrievalQuality: 'strong',
    knowledgeStatus: 'not_applicable',
    requestedProductText: 'chocolat noir',
  })).toEqual({
    intent: 'recommendation',
    intentConfidence: 0.83,
    demandStatus: 'fulfilled',
    retrievalQuality: 'strong',
    knowledgeStatus: 'not_applicable',
    requestedProductText: 'chocolat noir',
  });
});

test('strict AI Core validator rejects malformed taxonomy instead of normalizing it', () => {
  expect(() => validateNalaSemanticEnrichment({
    intent: 'invented',
    intentConfidence: 0.5,
    demandStatus: 'fulfilled',
    retrievalQuality: 'strong',
    knowledgeStatus: 'not_applicable',
    requestedProductText: null,
  })).toThrow('invalid_semantic_enrichment');
});

test('strict AI Core validator rejects invalid confidence', () => {
  expect(() => validateNalaSemanticEnrichment({
    intent: 'product_search',
    intentConfidence: 2,
    demandStatus: 'fulfilled',
    retrievalQuality: 'strong',
    knowledgeStatus: 'not_applicable',
    requestedProductText: 'manioc',
  })).toThrow('invalid_semantic_enrichment');
});

test('provider failures retry twice and become terminal on attempt three', () => {
  expect(nextEnrichmentFailureStatus(1)).toBe('pending');
  expect(nextEnrichmentFailureStatus(2)).toBe('pending');
  expect(nextEnrichmentFailureStatus(3)).toBe('failed');
});
