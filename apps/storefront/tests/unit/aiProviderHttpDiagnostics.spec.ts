import { test, expect } from '@playwright/test';
import {
  openAiResponseFormat,
  providerHttpFailureCode,
} from '../../src/lib/ai/core/providers/openaiCompatibleAdapter';

test('OpenAI-compatible HTTP errors stay low-cardinality and diagnostic', () => {
  expect(providerHttpFailureCode(400)).toBe('provider_http_400');
  expect(providerHttpFailureCode(401)).toBe('provider_http_401');
  expect(providerHttpFailureCode(403)).toBe('provider_http_403');
  expect(providerHttpFailureCode(404)).toBe('provider_http_404');
  expect(providerHttpFailureCode(429)).toBe('rate_limit');
  expect(providerHttpFailureCode(500)).toBe('provider_http_5xx');
  expect(providerHttpFailureCode(503)).toBe('provider_http_5xx');
  expect(providerHttpFailureCode(418)).toBe('provider_error');
});

test('json_schema response format is opt-in per model and normalizes nullable fields', () => {
  const responseSchema = {
    type: 'object' as const,
    properties: {
      intent: { type: 'string' as const, enum: ['product_search', 'other'] },
      requestedProductText: { type: 'string' as const, nullable: true },
    },
    required: ['intent', 'requestedProductText'],
  };
  expect(openAiResponseFormat({ model: { config: {} }, responseSchema })).toEqual({ type: 'json_object' });
  expect(openAiResponseFormat({ model: { config: { responseFormat: 'json_schema' } }, responseSchema })).toEqual({
    type: 'json_schema',
    json_schema: {
      name: 'lepefy_response',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          intent: { type: 'string', enum: ['product_search', 'other'] },
          requestedProductText: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['intent', 'requestedProductText'],
        additionalProperties: false,
      },
    },
  });
});
