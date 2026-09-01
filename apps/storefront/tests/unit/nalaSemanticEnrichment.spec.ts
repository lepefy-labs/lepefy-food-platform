import { expect, test } from '@playwright/test';
import {
  deterministicSmallTalkEnrichment,
  nextEnrichmentFailureStatus,
  normalizeNalaSemanticEnrichment,
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

test('provider failures retry twice and become terminal on attempt three', () => {
  expect(nextEnrichmentFailureStatus(1)).toBe('pending');
  expect(nextEnrichmentFailureStatus(2)).toBe('pending');
  expect(nextEnrichmentFailureStatus(3)).toBe('failed');
});
