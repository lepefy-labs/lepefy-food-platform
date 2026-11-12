import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import { runInNewContext } from 'vm';
import ts from 'typescript';
import {
  aspectValue, centeredCrop, cropToPixels, defaultTitle, isRequestKey, isRetryableJobError, jobErrorMessage,
  quotaView, sanitizeCrop, studioErrorCode, STUDIO_ERRORS, STUDIO_JOB_ERROR_MESSAGES, viewStatuses,
} from '../../src/lib/studio/rules';
import { buildStudioPrompt, DEFAULT_STUDIO_STYLE, parseStudioStyle } from '../../src/lib/studio/style';
import { STUDIO_DESTINATIONS, STUDIO_DESTINATION_KEYS, destinationManageHref } from '../../src/lib/studio/destinations';
import { STUDIO_LIBRARY_VIEWS } from '../../src/lib/studio/domain';
import { AUDIT_EVENT_TYPES, AUDIT_MODULES } from '../../src/lib/audit/eventCatalog';
import { FEATURE_FLAG_DEFINITIONS } from '../../src/lib/featureFlags/featureFlagRegistry';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { STUDIO_ASSET_STATUS_META } from '../../src/lib/admin/statusRegistry';
import { featureForAiEndpoint } from '../../src/lib/ai/productUsage';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(ROOT, '../../supabase/migrations/183_image_studio.sql'), 'utf8')
  + readFileSync(resolve(ROOT, '../../supabase/migrations/184_image_studio_platform_settings.sql'), 'utf8');

// ─── Formats and crops ─────────────────────────────────────────────────────

test.describe('Studio images · crop rules', () => {
  test('ratios and centred crops of each destination format', () => {
    expect(aspectValue('1:1')).toBe(1);
    expect(aspectValue('16:9')).toBeCloseTo(16 / 9);
    expect(aspectValue(null)).toBeNull();
    expect(aspectValue('wide')).toBeNull();
    // Square image to 16:9: full width, centred band.
    const banner = centeredCrop(1024, 1024, 16 / 9);
    expect(banner.width).toBe(1);
    expect(banner.height).toBeCloseTo(0.5625, 3);
    expect(banner.y).toBeCloseTo((1 - 0.5625) / 2, 3);
    // Square image to 4:5: full height, centred column.
    const portrait = centeredCrop(1024, 1024, 4 / 5);
    expect(portrait.height).toBe(1);
    expect(portrait.width).toBeCloseTo(0.8, 3);
    // Already the right ratio or free format: whole image.
    expect(centeredCrop(1600, 1200, 4 / 3)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(centeredCrop(800, 600, null)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  test('a crop from the browser is only accepted when it moves the frame inside the image', () => {
    const ratio = 16 / 9;
    const centred = centeredCrop(1024, 1024, ratio);
    const moved = sanitizeCrop({ ...centred, y: 0 }, 1024, 1024, ratio);
    expect(moved.y).toBe(0);
    expect(moved.height).toBe(centred.height);
    // Outside, resized, wrong ratio or garbage → centred crop.
    expect(sanitizeCrop({ ...centred, y: 0.9 }, 1024, 1024, ratio)).toEqual(centred);
    expect(sanitizeCrop({ x: 0, y: 0, width: 0.5, height: 0.2 }, 1024, 1024, ratio)).toEqual(centred);
    expect(sanitizeCrop({ x: 'a' }, 1024, 1024, ratio)).toEqual(centred);
    expect(sanitizeCrop(null, 1024, 1024, ratio)).toEqual(centred);
    // Free format ignores any crop.
    expect(sanitizeCrop({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, 1024, 768, null)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  test('pixel rectangle never leaves the image', () => {
    const rect = cropToPixels({ x: 0.99, y: 0.99, width: 0.5, height: 0.5 }, 1000, 800);
    expect(rect.left + rect.width).toBeLessThanOrEqual(1000);
    expect(rect.top + rect.height).toBeLessThanOrEqual(800);
    expect(rect.width).toBeGreaterThanOrEqual(1);
  });
});

// ─── Requests, quotas, errors ──────────────────────────────────────────────

test.describe('Studio images · requests and errors', () => {
  test('request keys, titles and views', () => {
    expect(isRequestKey('a1b2c3d4e5')).toBe(true);
    expect(isRequestKey('../etc')).toBe(false);
    expect(isRequestKey('short')).toBe(false);
    expect(defaultTitle('prompt', 'des bananes vertes dans une cuisine claire et lumineuse')).toBe('Des bananes vertes dans une cuisine');
    expect(defaultTitle('photo', null, new Date('2026-11-12T10:00:00Z'))).toMatch(/^Photo du 12/);
    for (const view of STUDIO_LIBRARY_VIEWS) expect(viewStatuses(view).length).toBeGreaterThan(0);
    expect(viewStatuses('a-valider')).toEqual(['review']);
  });

  test('quota view: budget reached means no creation left', () => {
    expect(quotaView({ out_used: 10, out_limit: 60, out_cost_usd: '1.2', out_budget_usd: '20' }).remaining).toBe(50);
    expect(quotaView({ out_used: 10, out_limit: 60, out_cost_usd: '20', out_budget_usd: '20' }).remaining).toBe(0);
    expect(quotaView({ out_used: 70, out_limit: 60, out_cost_usd: 0, out_budget_usd: 20 }).remaining).toBe(0);
    expect(quotaView(null)).toMatchObject({ used: 0, limit: 60, budgetUsd: 20, remaining: 60 });
  });

  test('every SQL exception of 183 has a French message, nothing else leaks', () => {
    const raised = new Set([...migration.matchAll(/raise exception '(studio_[a-z_]+)'/g)].map((match) => match[1]!));
    for (const code of raised) expect(STUDIO_ERRORS[code], code).toBeTruthy();
    expect(studioErrorCode({ message: 'P0001: studio_quota_exceeded' })).toBe('studio_quota_exceeded');
    expect(studioErrorCode({ message: 'duplicate key value violates…' })).toBeNull();
    expect(jobErrorMessage('safety_blocked')).toContain('Reformulez');
    expect(jobErrorMessage('something_new')).toBe(STUDIO_JOB_ERROR_MESSAGES.provider_error);
    expect(isRetryableJobError('provider_timeout')).toBe(true);
    expect(isRetryableJobError('safety_blocked')).toBe(false);
    // Provider credit exhausted (HTTP 402): retrying only spends attempts.
    expect(isRetryableJobError('provider_billing')).toBe(false);
    expect(jobErrorMessage('provider_billing')).toMatch(/Lepefy a été prévenu/);
    for (const message of [...Object.values(STUDIO_ERRORS).map((e) => e.message), ...Object.values(STUDIO_JOB_ERROR_MESSAGES)]) {
      expect(message).not.toMatch(/gemini|openai|google|api key/i);
    }
  });
});

// ─── Style and prompts (runbook rules) ─────────────────────────────────────

test.describe('Studio images · style and prompts', () => {
  test('default style follows the product image runbook and validates', () => {
    expect(parseStudioStyle(DEFAULT_STUDIO_STYLE)).not.toBeNull();
    expect(DEFAULT_STUDIO_STYLE.composition).toMatch(/1:1/);
    expect(DEFAULT_STUDIO_STYLE.composition).toMatch(/10–12 %/);
    expect(DEFAULT_STUDIO_STYLE.background).toMatch(/off-white/);
    expect(DEFAULT_STUDIO_STYLE.avoid.join(' ')).toMatch(/watermark/);
    expect(parseStudioStyle({ ...DEFAULT_STUDIO_STYLE, extra: 1 })).toBeNull();
    expect(parseStudioStyle({ ...DEFAULT_STUDIO_STYLE, summary: '' })).toBeNull();
  });

  test('a photo edit keeps the real product and never invents label facts', () => {
    const prompt = buildStudioPrompt({ origin: 'photo', style: DEFAULT_STUDIO_STYLE, request: 'enlever le piment rouge', correction: null });
    expect(prompt).toMatch(/same label, logo and printed text/);
    expect(prompt).toContain('"enlever le piment rouge"');
    expect(prompt).toMatch(/invented ingredients, certifications/);
  });

  test('an idea never shows packaging, brands or text, whatever the description says', () => {
    const prompt = buildStudioPrompt({ origin: 'prompt', style: DEFAULT_STUDIO_STYLE, request: 'un paquet "Chloe Food" de poivre', correction: null });
    expect(prompt).toMatch(/show no packaging, no branded product, no logo, no label, no written text/);
    // The user's quotes cannot close the quoted block.
    expect(prompt).toContain('"un paquet \'Chloe Food\' de poivre"');
  });

  test('a correction changes only what is asked, and keeps the ambiance rule', () => {
    const photo = buildStudioPrompt({ origin: 'photo', style: DEFAULT_STUDIO_STYLE, request: 'x', correction: 'moins de sauce' });
    expect(photo).toMatch(/Apply ONLY the following change/);
    expect(photo).toMatch(/Never invent or alter text/);
    const idea = buildStudioPrompt({ origin: 'prompt', style: DEFAULT_STUDIO_STYLE, request: 'x', correction: 'plus de lumière' });
    expect(idea).toMatch(/must still show no packaging/);
  });
});

// ─── Registries and parity ─────────────────────────────────────────────────

test.describe('Studio images · registries', () => {
  test('destination registry: unique keys, server implementation for each, formats and pages', () => {
    const keys = STUDIO_DESTINATIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...STUDIO_DESTINATION_KEYS].sort());
    const server = readFileSync(resolve(ROOT, 'src/lib/studio/server/destinations.ts'), 'utf8');
    const implBlock = server.slice(server.indexOf('STUDIO_DESTINATION_IMPLS'));
    for (const key of keys) {
      expect(implBlock, key).toMatch(new RegExp(`\\b${key}\\b`));
      expect(destinationManageHref(key, 'x')).toMatch(/^\/admin\//);
    }
    for (const destination of STUDIO_DESTINATIONS) {
      expect(destination.minWidth).toBeLessThanOrEqual(destination.maxEdge);
      if (destination.aspect) expect(aspectValue(destination.aspect)).not.toBeNull();
      expect(['catalog.manage', 'tenant_settings.manage', 'events.manage', 'event_content.manage']).toContain(destination.permission);
    }
    // Identity assets are never a Studio destination.
    expect(keys.join(' ')).not.toMatch(/logo|icon|label/);
    // A product shows a real product: an atmosphere image needs confirmation there.
    expect(STUDIO_DESTINATIONS.find((d) => d.key === 'product')?.confirmAmbiance).toBe(true);
  });

  test('audit catalogue, flag, permissions and status registry match migration 183', () => {
    const sqlTypes = [...migration.matchAll(/\('(studio\.[a-z_.]+)', 'studio'/g)].map((match) => match[1]!).sort();
    const appTypes = Object.keys(AUDIT_EVENT_TYPES).filter((key) => key.startsWith('studio.')).sort();
    expect(appTypes).toEqual(sqlTypes);
    expect(AUDIT_MODULES.studio.anyOf).toEqual(['studio.use']);
    const flag = FEATURE_FLAG_DEFINITIONS.find((definition) => definition.key === 'image_studio');
    expect(flag?.platformOnly).toBe(true);
    expect(permissionForAdminApi('/api/admin/studio/assets', 'POST')).toBe('studio.use');
    expect(permissionForAdminApi('/api/admin/studio/usages/x', 'DELETE')).toBe('studio.use');
    for (const status of ['processing', 'review', 'approved', 'failed', 'discarded', 'archived']) {
      expect(STUDIO_ASSET_STATUS_META[status], status).toBeTruthy();
      expect(migration).toContain(`'${status}'`);
    }
  });

  test('every Studio admin API route goes through the Studio guard; the worker only through its bearer', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(resolve(dir, entry.name)) : entry.name === 'route.ts' ? [resolve(dir, entry.name)] : []);
    const routes = walk(resolve(ROOT, 'src/app/api/admin/studio'));
    expect(routes.length).toBeGreaterThanOrEqual(8);
    for (const file of routes) {
      const text = readFileSync(file, 'utf8');
      const handlers = (text.match(/export async function (GET|POST|PATCH|DELETE)/g) ?? []).length;
      expect((text.match(/await studioApi\(\)/g) ?? []).length, file).toBe(handlers);
      // The tenant always comes from the server, never the body.
      expect(text, file).not.toMatch(/body\??\.tenantId|tenant_id: body/);
    }
    const worker = readFileSync(resolve(ROOT, 'src/app/api/internal/studio-worker/route.ts'), 'utf8');
    expect(worker).toMatch(/STUDIO_WORKER_TOKEN/);
    expect(worker).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  test('nothing private is public: proposals live in the private bucket, publication copies per destination', () => {
    expect(migration).toMatch(/values \('studio-private', 'studio-private', false/);
    const storage = readFileSync(resolve(ROOT, 'src/lib/studio/server/storage.ts'), 'utf8');
    expect(storage).not.toMatch(/getPublicUrl|from\('assets'\)/);
    const publish = readFileSync(resolve(ROOT, 'src/lib/studio/server/publish.ts'), 'utf8');
    // Order of the promotion: copy → verify → reference update.
    const order = ['impl.store(', 'verifyPublicCopy(', 'impl.attach('].map((needle) => publish.indexOf(needle));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

// ─── Provider chain (no network) ───────────────────────────────────────────

function loadRegistry() {
  const filename = resolve(ROOT, 'src/lib/studio/server/providers/registry.ts');
  const nativeRequire = createRequire(filename);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const typesFile = resolve(ROOT, 'src/lib/studio/server/providers/types.ts');
  const typesExports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(typesFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: typesExports, require: nativeRequire }, { filename: typesFile });
  const exports: Record<string, unknown> = {};
  runInNewContext(output, {
    exports, process, console, setTimeout, clearTimeout, AbortController,
    require(id: string) {
      if (id === 'server-only') return {};
      if (id === './gemini') return { geminiImageProvider: {} };
      if (id === './openai') return { openaiImageProvider: {} };
      if (id === './types') return typesExports;
      return nativeRequire(id);
    },
  }, { filename });
  return { registry: exports as any, types: typesExports as any };
}

/** Rejection of a promise created in the VM realm (expect().rejects needs a native promise). */
async function failure(promise: Promise<unknown>): Promise<{ code?: string }> {
  try { await promise; } catch (error) { return { code: (error as { code?: string }).code }; }
  throw new Error('expected a failure');
}

test.describe('Studio images · provider chain', () => {
  const candidate = (key: string, providerType = 'gemini') => ({ key, providerModelId: key, providerKey: providerType, providerType, baseUrl: null, credentialRef: 'GEMINI_API_KEY', priority: 1 });
  const request = { capability: 'photo_edit', prompt: 'p', input: null, aspectRatio: '1:1' };

  test('falls back on a missing key or provider error, stops on a refusal', async () => {
    const { registry, types } = loadRegistry();
    const calls: string[] = [];
    const adapters = {
      gemini: { async run(_r: unknown, model: { key: string }) {
        calls.push(model.key);
        if (model.key === 'broken') throw new types.StudioProviderError('provider_error');
        if (model.key === 'refuses') throw new types.StudioProviderError('safety_blocked');
        return { bytes: Buffer.from('img'), mime: 'image/png', images: 1 };
      } },
    };
    const ok = await registry.runStudioImage([candidate('broken'), candidate('good')], request, { timeoutMs: 1000, adapters, credential: () => 'k' });
    expect(ok.model.key).toBe('good');
    expect(ok.attempts).toEqual([{ model: 'broken', code: 'provider_error' }]);

    expect(await failure(registry.runStudioImage([candidate('refuses'), candidate('good')], request, { timeoutMs: 1000, adapters, credential: () => 'k' })))
      .toMatchObject({ code: 'safety_blocked' });
    expect(calls.at(-1)).toBe('refuses');

    const noKey = await registry.runStudioImage([candidate('a'), candidate('good')], request, { timeoutMs: 1000, adapters, credential: (ref: string) => (ref ? undefined : 'k') }).catch((error: { code: string }) => error);
    expect(noKey).toMatchObject({ code: 'missing_credential' });
    expect(await failure(registry.runStudioImage([], request, { timeoutMs: 1000, adapters }))).toMatchObject({ code: 'no_enabled_model' });
  });

  test('a provider slower than the timeout is aborted and reported as timeout', async () => {
    const { registry } = loadRegistry();
    const adapters = { gemini: { run: (r: { signal: AbortSignal }) => new Promise((_, reject) => r.signal.addEventListener('abort', () => reject(new Error('aborted')))) } };
    expect(await failure(registry.runStudioImage([candidate('slow'), candidate('other')], request, { timeoutMs: 20, adapters, credential: () => 'k' })))
      .toMatchObject({ code: 'provider_timeout' });
  });

  test('costs are reported in the AI cost console as « Studio images »', () => {
    expect(featureForAiEndpoint('studio-image').label).toBe('Studio images');
    const worker = readFileSync(resolve(ROOT, 'src/lib/studio/server/worker.ts'), 'utf8');
    // The usage log stores the same amount as the revision (no double count of image tokens).
    expect(worker).toMatch(/estimatedCostUsd: cost/);
    expect(worker).toMatch(/endpoint: 'studio-image'/);
  });

  test('cost: flat price per image when known, tokens otherwise', () => {
    const { registry } = loadRegistry();
    expect(registry.computeStudioCost({ input_price_per_million: '0.30', output_price_per_million: '2.50', image_price_flat: '0.039' }, { inputTokens: 1000, outputTokens: 1290, images: 1 })).toBeCloseTo(0.0393, 4);
    expect(registry.computeStudioCost({ input_price_per_million: '8', output_price_per_million: '30', image_price_flat: null }, { inputTokens: 1000, outputTokens: 4000 })).toBeCloseTo(0.128, 4);
    expect(registry.computeStudioCost(null, { images: 1 })).toBe(0);
  });
});
