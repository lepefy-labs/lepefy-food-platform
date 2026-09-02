import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { AiContextError, AiRoutingError, type AdapterRequest } from '../../src/lib/ai/core/types';
import { runAiCoreMaintenance } from '../../src/lib/ai/core/maintenance';
import { approvedInferenceUrl, openaiCompatibleAdapter } from '../../src/lib/ai/core/providers/openaiCompatibleAdapter';
import { orderCandidates } from '../../src/lib/ai/core/router';
import type * as GatewayModule from '../../src/lib/ai/core/aiGateway';
import type * as ContextModule from '../../src/lib/ai/core/conversationContext';

/** Load actual server module source with only I/O imports replaced.
 * No global require hooks, HTTP requests, Next route mocks or provider calls.
 */
function loadServerModule<T>(name: string, db: unknown): T {
  const filename = resolve(__dirname, '../../src/lib/ai/core', name + '.ts');
  const nativeRequire = createRequire(filename);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const blockedAdapter = { generate() { throw new Error('Provider must not be called when persistence fails'); } };
  runInNewContext(output, {
    exports, process, console,
    require(id: string) {
      if (id === 'server-only') return {};
      if (id === '@/lib/supabase/server') return { createServiceClient: () => db };
      if (id === '@/lib/ai/usageTracking') return { logAiUsage: async () => {} };
      if (id === './providers/geminiAdapter') return { geminiAdapter: blockedAdapter };
      if (id === './providers/openaiCompatibleAdapter') return { openaiCompatibleAdapter: blockedAdapter };
      return nativeRequire(id);
    },
  }, { filename });
  return exports as T;
}

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'single', 'maybeSingle']) {
    chain[method] = () => chain;
  }
  const promise = Promise.resolve(result);
  chain.then = promise.then.bind(promise);
  return chain;
}

for (const code of ['42P01', 'PGRST205', 'PGRST202']) {
  test('routing schema unavailable fails closed: ' + code, async () => {
    const gateway = loadServerModule<typeof GatewayModule>('aiGateway', {
      from: () => query({ data: null, error: { code, message: 'private DB detail' } }),
    });
    await expect(gateway.runAi({ tenantId: 'tenant', endpoint: 'chatbox',
      consumer: 'nala', capability: 'structured_chat',
      request: { system: '', messages: [], responseSchema: { type: 'object' }, validate: value => value },
    })).rejects.toMatchObject({ name: 'AiRoutingError', message: 'ai_routing_failed', reasons: ['policy_load_failed'] });
  });

  test('conversation RPC unavailable never returns stateless context: ' + code, async () => {
    const context = loadServerModule<typeof ContextModule>('conversationContext', {
      rpc: async () => ({ data: null, error: { code, message: 'private DB detail' } }),
      from() { throw new Error('No reads allowed after failed open'); },
    });
    await expect(context.openConversation({ tenantId: 'tenant', consumer: 'nala', conversationId: null, locale: 'fr' }))
      .rejects.toBeInstanceOf(AiContextError);
  });
}

test('registry transport failure is normalized and does not select an adapter', async () => {
  const gateway = loadServerModule<typeof GatewayModule>('aiGateway', {
    from() { throw new Error('private connection information'); },
  });
  await expect(gateway.runAi({ tenantId: 'tenant', endpoint: 'chatbox', consumer: 'nala', capability: 'structured_chat',
    request: { system: '', messages: [], responseSchema: { type: 'object' }, validate: value => value },
  })).rejects.toBeInstanceOf(AiRoutingError);
});

test('missing persistent conversation result and transport failure are normalized', async () => {
  for (const rpc of [
    async () => ({ data: null, error: null }),
    async () => { throw new Error('private connection information'); },
  ]) {
    const context = loadServerModule<typeof ContextModule>('conversationContext', { rpc });
    await expect(context.openConversation({ tenantId: 'tenant', consumer: 'nala', conversationId: null, locale: 'fr' }))
      .rejects.toMatchObject({ name: 'AiContextError', message: 'conversation_unavailable' });
  }
});

test('maintenance normalizes successful count including zero', async () => {
  expect(await runAiCoreMaintenance(async () => ({ data: 0, error: null }))).toEqual({ deletedConversations: 0 });
  expect(await runAiCoreMaintenance(async () => ({ data: '12', error: null }))).toEqual({ deletedConversations: 12 });
});

test('maintenance rejects RPC errors, transport errors and malformed counts without leaking details', async () => {
  for (const purge of [
    async () => ({ data: null, error: { message: 'private DB information' } }),
    async () => { throw new Error('private connection information'); },
    ...[null, -1, 1.5, 'invalid', Number.MAX_SAFE_INTEGER + 1].map(data => async () => ({ data, error: null })),
  ]) {
    await expect(runAiCoreMaintenance(purge)).rejects.toThrow('ai_core_maintenance_failed');
  }
});

const oldOrigins = process.env.LEPEFY_AI_ALLOWED_ORIGINS;
const oldFetch = globalThis.fetch;
test.afterEach(() => {
  if (oldOrigins === undefined) delete process.env.LEPEFY_AI_ALLOWED_ORIGINS;
  else process.env.LEPEFY_AI_ALLOWED_ORIGINS = oldOrigins;
  globalThis.fetch = oldFetch;
});

test('OpenAI-compatible origin allowlist accepts explicit HF origin and rejects unsafe URLs', () => {
  process.env.LEPEFY_AI_ALLOWED_ORIGINS = 'https://router.huggingface.co';
  expect(approvedInferenceUrl('https://router.huggingface.co/v1')).toBe('https://router.huggingface.co/v1/chat/completions');
  for (const base of [
    'http://router.huggingface.co/v1',
    'https://username:password@router.huggingface.co/v1',
    'https://router.huggingface.co.evil.example/v1',
    'https://unapproved.example/v1',
    'https://router.huggingface.co/v1?secret=redacted',
    'https://router.huggingface.co/v1#fragment',
  ]) expect(() => approvedInferenceUrl(base)).toThrow();
  delete process.env.LEPEFY_AI_ALLOWED_ORIGINS;
  expect(() => approvedInferenceUrl('https://router.huggingface.co/v1')).toThrow();
});

function adapterRequest(): AdapterRequest<unknown> {
  return {
    system: 'Return JSON', messages: [{ role: 'user', content: 'Test' }], responseSchema: { type: 'object' },
    validate: value => value, credential: 'test-only-placeholder', signal: new AbortController().signal,
    provider: { id: 'hf', key: 'huggingface', name: 'HF', provider_type: 'openai_compatible', enabled: true,
      credential_ref: 'HUGGINGFACE_API_KEY', base_url: 'https://router.huggingface.co/v1', config: {}, health_status: 'degraded' },
    model: { id: 'hf-model', key: 'hf-gpt-oss-20b', provider_id: 'hf', provider_model_id: 'openai/gpt-oss-20b:fastest',
      display_name: 'GPT-OSS 20B', enabled: true, capabilities: { chat: true, structured_output: true },
      context_window: null, cost_class: null, input_cost_per_million: null, output_cost_per_million: null, config: {} },
  };
}

test('OpenAI-compatible adapter forbids redirect following and rejects redirect response', async () => {
  process.env.LEPEFY_AI_ALLOWED_ORIGINS = 'https://router.huggingface.co';
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    expect(input).toBe('https://router.huggingface.co/v1/chat/completions');
    expect(init?.redirect).toBe('error');
    return new Response('', { status: 302, headers: { Location: 'https://unapproved.example' } });
  };
  await expect(openaiCompatibleAdapter.generate(adapterRequest())).rejects.toThrow('provider_error');
  expect(calls).toBe(1);
});

test('observational degraded health does not remove an enabled routing candidate', () => {
  const request = adapterRequest();
  expect(orderCandidates([{ model: request.model, provider: request.provider, enabled: true,
    priority: 2, timeout_ms: 6000, min_confidence: null }])).toHaveLength(1);
});
