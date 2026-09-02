import { test, expect } from '@playwright/test';
import { routeAi, LocalCircuitBreaker, orderCandidates } from '../../src/lib/ai/core/router';
import { AiAttemptError, AiRoutingError, type AiCandidate, type AiRequest } from '../../src/lib/ai/core/types';
import { boundedContext, emptyMemory, memoryFromDecision } from '../../src/lib/ai/core/contextPackage';
import { nalaResponseValidator, type NalaDecision } from '../../src/lib/ai/core/nalaDecision';
import { routingMutation } from '../../src/lib/ai/core/routingConfig';
import { permissionForAdminPath } from '../../src/lib/auth/adminRoutePermissions';

function candidate(key: string, priority = 1): AiCandidate {
  return { enabled: true, priority, timeout_ms: 100, min_confidence: null,
    provider: { id: key, key, name: key, provider_type: 'gemini', enabled: true,
      credential_ref: 'TEST_API_KEY', base_url: null, config: {}, health_status: 'unknown' },
    model: { id: key, key, provider_id: key, provider_model_id: key, display_name: key, enabled: true,
      capabilities: { chat: true, structured_output: true }, context_window: null, cost_class: null,
      input_cost_per_million: null, output_cost_per_million: null, config: {} } };
}
const request: AiRequest<{ reply: string }> = {
  system: 'JSON', messages: [{ role: 'user', content: 'Bonjour' }],
  responseSchema: { type: 'object' },
  validate: value => {
    if (!value || typeof (value as { reply?: unknown }).reply !== 'string') throw new Error('schema');
    return value as { reply: string };
  },
};
test('priority order, disabled models and stable ties', () => {
  const disabled = candidate('disabled'); disabled.model.enabled = false;
  expect(orderCandidates([candidate('z', 2), candidate('b'), candidate('a'), disabled]).map(c => c.model.key))
    .toEqual(['a', 'b', 'z']);
});
test('first success stops; provider error and invalid schema fallback', async () => {
  for (const failure of ['none', 'error', 'json', 'schema', 'rate_limit']) {
    const calls: string[] = [];
    const response = await routeAi({ candidates: [candidate('a'), candidate('b', 2)], request,
      credential: () => 'test', circuit: new LocalCircuitBreaker(), telemetry: async () => {},
      adapter: () => ({ async generate(r) {
        calls.push(r.model.key);
        if (r.model.key === 'a' && failure === 'error') throw new Error('provider');
        if (r.model.key === 'a' && failure === 'rate_limit') throw new AiAttemptError('rate_limit');
        return { text: r.model.key === 'a' && failure === 'json' ? 'bad'
          : r.model.key === 'a' && failure === 'schema' ? '{}' : '{"reply":"ok"}' };
      } }),
    });
    expect(response.model).toBe(failure === 'none' ? 'a' : 'b');
    expect(calls).toHaveLength(failure === 'none' ? 1 : 2);
    expect(response.fallbackUsed).toBe(failure !== 'none');
  }
});
test('missing credential skips provider, all fail has normalized error', async () => {
  const a = candidate('a'); const b = candidate('b', 2); b.provider.credential_ref = null;
  const calls: string[] = [];
  const params = { candidates: [a,b], request, credential: () => undefined,
    circuit: new LocalCircuitBreaker(), telemetry: async () => {},
    adapter: () => ({ async generate(r: { model: { key: string } }) { calls.push(r.model.key); return { text: '{"reply":"ok"}' }; } }) };
  expect((await routeAi(params)).model).toBe('b'); expect(calls).toEqual(['b']);
  await expect(routeAi({ ...params, candidates: [a] })).rejects.toBeInstanceOf(AiRoutingError);
});
test('timeout aborts and calibrated confidence is optional', async () => {
  let aborted = false;
  const a = candidate('a'); a.timeout_ms = 5; a.min_confidence = 0.9;
  const result = await routeAi({ candidates: [a, candidate('b',2)], request,
    credential: () => 'test', circuit: new LocalCircuitBreaker(), telemetry: async () => {},
    adapter: () => ({ async generate(r) {
      if (r.model.key === 'a') return new Promise<never>((_, reject) => r.signal.addEventListener('abort', () => {
        aborted = true; reject(new AiAttemptError('provider_timeout'));
      }));
      return { text: '{"reply":"ok"}' };
    } }),
  });
  expect(aborted).toBe(true); expect(result.model).toBe('b');
  expect((await routeAi({ candidates: [a], request, credential: () => 'test',
    circuit: new LocalCircuitBreaker(), telemetry: async () => {},
    adapter: () => ({ async generate() { return { text: '{"reply":"ok"}' }; } }),
  })).model).toBe('a');
});
test('local circuit opens after five failures and expires', () => {
  const circuit = new LocalCircuitBreaker();
  for (let i=0;i<5;i++) circuit.failure('a', 100);
  expect(circuit.blocked('a',101)).toBe(true);
  expect(circuit.blocked('a',300101)).toBe(false);
});
const decision: NalaDecision = {
  intent: 'meal_preparation', commerceMode: 'cart_builder', confidence: null,
  subject: { type: 'dish', name: 'ndolé' }, entities: { dish: 'ndolé', product: null }, pendingAction: 'cart_builder',
};
test('working memory retains pending dish and provider-independent bounded context', async () => {
  const memory = memoryFromDecision(decision,'fr');
  const context = boundedContext({ system: 'x'.repeat(50000), memory, summary: null,
    turns: Array.from({ length: 100 }, () => ({ role: 'user' as const, content: 'y'.repeat(3000) })), message: 'Oui' });
  expect(context.messages.length).toBeLessThanOrEqual(11);
  expect(context.messages.reduce((n,m) => n+m.content.length,0)).toBeLessThanOrEqual(8300);
  expect(context.system.length).toBeLessThan(21000);
  expect(context.system).toContain('ndolé'); expect(context.system).toContain('cart_builder');
  const seen: string[] = [];
  for (const model of ['a', 'b']) {
    await routeAi({ candidates: [candidate(model)], request: { ...request, ...context },
      credential: () => 'test', circuit: new LocalCircuitBreaker(), telemetry: async () => {},
      adapter: () => ({ async generate(r) { seen.push(r.system); return { text: '{"reply":"ok"}' }; } }),
    });
  }
  expect(seen[0]).toBe(seen[1]);
});
test('runtime decision validates controlled taxonomy and bounded entities', () => {
  expect(nalaResponseValidator.safeParse({ reply: 'Bonjour', decision, cartPlan: null }).success).toBe(true);
  expect(nalaResponseValidator.safeParse({ reply: 'Bonjour', decision: { ...decision, intent: 'buy_now' }, cartPlan: null }).success).toBe(false);
  expect(nalaResponseValidator.safeParse({ reply: 'Bonjour', decision: { ...decision, confidence: 2 }, cartPlan: null }).success).toBe(false);
  expect(emptyMemory('fr').pendingAction).toBeNull();
});
test('admin boundaries and raw secret fields rejected', () => {
  expect(permissionForAdminPath('/admin/platform/ai-routing','shop')).toBe('platform.access');
  expect(routingMutation.safeParse({ kind: 'provider', values: {
    key: 'custom', name: 'Custom', provider_type: 'openai_compatible', enabled: false,
    credential_ref: 'OPENAI_API_KEY', base_url: null, config: { apiKey: 'secret' },
  } }).success).toBe(false);
});

test('only calibrated adapter confidence triggers threshold fallback; telemetry failure does not', async () => {
  const a = candidate('a'); a.min_confidence = 0.9;
  const response = await routeAi({ candidates: [a, candidate('b',2)], request,
    credential: () => 'test', circuit: new LocalCircuitBreaker(), telemetry: async () => { throw new Error('logging'); },
    adapter: () => ({ async generate(r) { return { text: '{"reply":"ok"}', confidence: r.model.key === 'a' ? 0.1 : undefined }; } }),
  });
  expect(response.model).toBe('b');
});
