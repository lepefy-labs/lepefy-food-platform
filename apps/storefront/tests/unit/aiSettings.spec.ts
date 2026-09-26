import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AI_CAPABILITIES_OFF, AI_DEFAULTS, aiModule, getAiCapabilities, getNalaExtraContext,
  resolveAiCapabilities, resolveNalaExtraContext,
} from '../../src/lib/ai/aiSettings';
import { resolveModuleConfig } from '../../src/lib/tenantConfig/moduleConfig';

function fakeDb(result: { data: unknown; error: unknown } | Error) {
  const eqCalls: unknown[][] = [];
  const builder: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject);
      }
      return (...args: unknown[]) => { if (prop === 'eq') eqCalls.push(args); return builder; };
    },
  });
  return { db: { from: () => builder } as unknown as SupabaseClient, eqCalls };
}

const legacy = { ai_image_generation: false, ai_description_generation: true, ai_semantic_search: true };
const stored = { ...AI_DEFAULTS, image_generation: true, description_generation: false, semantic_search: true };

test('missing row (migration 134 not applied) keeps the legacy flags', () => {
  expect(resolveAiCapabilities(resolveModuleConfig(aiModule, null), legacy)).toEqual({
    imageGeneration: false, descriptionGeneration: true, semanticSearch: true,
  });
  expect(resolveAiCapabilities(null, {})).toEqual(AI_CAPABILITIES_OFF);
});

test('valid enabled row wins over the legacy columns', () => {
  const state = resolveModuleConfig(aiModule, { enabled: true, config: stored });
  expect(resolveAiCapabilities(state, legacy)).toEqual({ imageGeneration: true, descriptionGeneration: false, semanticSearch: true });
});

test('partial row uses the column defaults (capabilities off) for missing keys', () => {
  const state = resolveModuleConfig(aiModule, { enabled: true, config: { semantic_search: true } });
  expect(resolveAiCapabilities(state, legacy)).toEqual({ imageGeneration: false, descriptionGeneration: false, semanticSearch: true });
});

test('disabled or invalid rows turn every capability off', () => {
  expect(resolveAiCapabilities(resolveModuleConfig(aiModule, { enabled: false, config: stored }), legacy)).toEqual(AI_CAPABILITIES_OFF);
  for (const config of [
    { image_generation: 'yes' }, { rate_limit_public_per_day: -1 }, { rate_limit_public_per_minute: 1.5 },
    { rate_limit_admin_per_day: 2_000_000 }, { version: 2 },
  ]) {
    const state = resolveModuleConfig(aiModule, { enabled: true, config });
    expect(state.status, JSON.stringify(config)).toBe('invalid');
    expect(resolveAiCapabilities(state, legacy)).toEqual(AI_CAPABILITIES_OFF);
  }
});

test('read is tenant-scoped; read failure uses the mirrored legacy columns', async () => {
  const ok = fakeDb({ data: { enabled: true, config: stored }, error: null });
  expect((await getAiCapabilities(ok.db, 'tenant-a', legacy)).imageGeneration).toBe(true);
  expect(ok.eqCalls).toEqual([['tenant_id', 'tenant-a'], ['feature_key', 'ai']]);
  const failing = fakeDb(new Error('network'));
  expect(await getAiCapabilities(failing.db, 'tenant-a', legacy)).toEqual({ imageGeneration: false, descriptionGeneration: true, semanticSearch: true });
});

test('Nala context: the settings key wins, even when cleared', () => {
  expect(resolveNalaExtraContext({ extra_context: 'Ouvert le dimanche' }, 'legacy')).toBe('Ouvert le dimanche');
  expect(resolveNalaExtraContext({ extra_context: null }, 'legacy')).toBeNull();
  expect(resolveNalaExtraContext({ extra_context: '   ' }, 'legacy')).toBeNull();
});

test('Nala context: no key or no row falls back to the legacy column', () => {
  expect(resolveNalaExtraContext({}, 'Horaires : 9h-19h')).toBe('Horaires : 9h-19h');
  expect(resolveNalaExtraContext(null, 'Horaires : 9h-19h')).toBe('Horaires : 9h-19h');
  expect(resolveNalaExtraContext(null, null)).toBeNull();
  expect(resolveNalaExtraContext(['not', 'an', 'object'], '  ')).toBeNull();
});

test('Nala context is capped to the validated length', () => {
  expect(resolveNalaExtraContext({ extra_context: 'x'.repeat(25_000) }, null)).toHaveLength(20_000);
});

test('Nala context read is tenant-scoped and survives read errors', async () => {
  const ok = fakeDb({ data: { config: { extra_context: 'Contexte privé' } }, error: null });
  expect(await getNalaExtraContext(ok.db, 'tenant-a', 'legacy')).toBe('Contexte privé');
  expect(ok.eqCalls).toEqual([['tenant_id', 'tenant-a'], ['feature_key', 'nala']]);
  const failing = fakeDb({ data: null, error: { message: 'down' } });
  expect(await getNalaExtraContext(failing.db, 'tenant-a', 'legacy')).toBe('legacy');
});
