import { test, expect } from '@playwright/test';
import { providerHttpFailureCode } from '../../src/lib/ai/core/providers/openaiCompatibleAdapter';

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
