/**
 * Studio images · provider benchmark (docs/IMAGE_STUDIO.md §8).
 *
 * Manual only (GitHub Actions « Studio images benchmark »). For each candidate
 * model, separately for « photo edit » (real product photos of the sample
 * tenant + one correction) and « idea » (fixed French prompts + one
 * correction), it records: latency, provider tokens, cost from ai_pricing,
 * failures. Outputs go to artifacts/studio-benchmark/ (workflow artifact):
 * every input/output image, results.json and an HTML contact sheet with
 * shuffled anonymous labels for blind scoring. Nothing is written to the
 * database or to tenant storage. Uses the SAME prompt builder as production.
 *
 * Runs under Node type stripping: no `@/` alias, no enums.
 *   node --experimental-strip-types scripts/studio-benchmark.ts
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (read-only queries),
 *      GEMINI_API_KEY, optional OPENAI_API_KEY, STUDIO_BENCH_TENANT (slug),
 *      STUDIO_BENCH_SAMPLE (photos and ideas each, 1-12), STUDIO_BENCH_MODELS.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GoogleGenAI, Modality } from '@google/genai';
import { buildStudioPrompt, DEFAULT_STUDIO_STYLE } from '../src/lib/studio/style';

const OUT = 'artifacts/studio-benchmark';
const SUPABASE_URL = required('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const TENANT = process.env.STUDIO_BENCH_TENANT || 'chloefood';
const SAMPLE = Math.min(12, Math.max(1, Number(process.env.STUDIO_BENCH_SAMPLE || '10')));
const MODELS = (process.env.STUDIO_BENCH_MODELS || 'gemini:gemini-2.5-flash-image,gemini:gemini-3.1-flash-image-preview,gemini:gemini-3-pro-image-preview,openai:gpt-image-1.5')
  .split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [provider, model] = entry.split(':');
    return { provider: provider!, model: model! };
  });
const TIMEOUT_MS = 120_000;

const IDEAS = [
  'Des bananes plantain vertes et jaunes sur un plan de travail clair, lumière du matin',
  'Un bol de sauce arachide fumante avec du riz blanc, vue de trois quarts',
  'Des épices africaines en petits tas sur une planche en bois clair',
  'Un plat de ndolé avec des crevettes, servi dans une assiette blanche',
  'Des feuilles de manioc fraîches dans un panier tressé',
  'Un poisson braisé avec des oignons et du piment, sur une feuille de bananier',
  'Des beignets haricots dorés dans un bol, ambiance petit-déjeuner',
  'Un jus de bissap rouge dans un verre avec des glaçons et des fleurs d’hibiscus',
  'Des safous violets frais, certains coupés en deux',
  'Une marmite de poulet DG colorée, vue du dessus',
  'Des tubercules d’igname et de taro sur une table de cuisine',
  'Un assortiment de piments frais rouges, verts et jaunes',
];
const PHOTO_REQUESTS = ['', 'Fond plus clair et plus net', '', 'Recentrer le produit', '', '', 'Ombre plus douce', '', '', 'Lumière plus chaude', '', ''];
const CORRECTIONS = { photo: 'Rendre l’ombre sous le produit un peu plus légère, sans rien changer d’autre', prompt: 'Lumière un peu plus chaude, sans rien ajouter' };

function required(name: string): string {
  const value = process.env[name];
  if (!value) { console.error(`Missing ${name}`); process.exit(2); }
  return value;
}

async function rest<T>(path: string): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!response.ok) throw new Error(`rest ${path.split('?')[0]} ${response.status}`);
  return response.json() as Promise<T>;
}

interface Pricing { provider: string; model: string; input_price_per_million: number | null; output_price_per_million: number | null; image_price_flat: number | null }

function cost(pricing: Pricing | undefined, usage: { inputTokens?: number; outputTokens?: number }): number | null {
  if (!pricing) return null;
  const input = Number(pricing.input_price_per_million ?? 0) * (usage.inputTokens ?? 0) / 1e6;
  const output = pricing.image_price_flat != null ? Number(pricing.image_price_flat) : Number(pricing.output_price_per_million ?? 0) * (usage.outputTokens ?? 0) / 1e6;
  return Math.round((input + output) * 10_000) / 10_000;
}

interface CallResult { ok: boolean; code?: string; bytes?: Buffer; mime?: string; inputTokens?: number; outputTokens?: number; latencyMs: number }

const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

async function callModel(provider: string, model: string, prompt: string, input: { bytes: Buffer; mime: string } | null): Promise<CallResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (provider === 'gemini') {
      if (!gemini) return { ok: false, code: 'missing_credential', latencyMs: 0 };
      const parts: Array<Record<string, unknown>> = [];
      if (input) parts.push({ inlineData: { mimeType: input.mime, data: input.bytes.toString('base64') } });
      parts.push({ text: prompt });
      const response = await gemini.models.generateContent({
        model, contents: [{ role: 'user', parts }],
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT], imageConfig: { aspectRatio: '1:1' }, abortSignal: controller.signal },
      } as never);
      const image = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
      const latencyMs = Date.now() - start;
      if (!image?.inlineData?.data) return { ok: false, code: response.promptFeedback?.blockReason ? 'safety_blocked' : 'no_image', latencyMs };
      return { ok: true, bytes: Buffer.from(image.inlineData.data, 'base64'), mime: image.inlineData.mimeType ?? 'image/png',
        inputTokens: response.usageMetadata?.promptTokenCount, outputTokens: response.usageMetadata?.candidatesTokenCount, latencyMs };
    }
    if (provider === 'openai') {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return { ok: false, code: 'missing_credential', latencyMs: 0 };
      let response: Response;
      if (input) {
        const form = new FormData();
        form.append('model', model); form.append('prompt', prompt); form.append('size', '1024x1024');
        form.append('image', new Blob([new Uint8Array(input.bytes)], { type: input.mime }), 'input.' + (input.mime === 'image/png' ? 'png' : 'jpg'));
        response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: controller.signal });
      } else {
        response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt, size: '1024x1024' }), signal: controller.signal,
        });
      }
      const json = await response.json().catch(() => null) as { data?: Array<{ b64_json?: string }>; usage?: { input_tokens?: number; output_tokens?: number }; error?: { code?: string } } | null;
      const latencyMs = Date.now() - start;
      if (!response.ok) return { ok: false, code: json?.error?.code ?? `http_${response.status}`, latencyMs };
      const data = json?.data?.[0]?.b64_json;
      if (!data) return { ok: false, code: 'no_image', latencyMs };
      return { ok: true, bytes: Buffer.from(data, 'base64'), mime: 'image/png', inputTokens: json?.usage?.input_tokens, outputTokens: json?.usage?.output_tokens, latencyMs };
    }
    return { ok: false, code: 'unknown_provider', latencyMs: 0 };
  } catch (error) {
    return { ok: false, code: controller.signal.aborted ? 'provider_timeout' : `error_${String((error as { status?: number }).status ?? 'unknown')}`, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

function ext(mime: string) { return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'; }

async function main() {
  mkdirSync(`${OUT}/images`, { recursive: true });
  if (gemini) {
    const available: string[] = [];
    try { for await (const m of await gemini.models.list()) if (m.name && /image/.test(m.name)) available.push(m.name.replace('models/', '')); } catch { /* listing optional */ }
    console.log('Gemini image models available:', available.join(', ') || 'unknown');
    writeFileSync(`${OUT}/gemini-models.json`, JSON.stringify(available, null, 2));
  }
  const [tenant] = await rest<Array<{ id: string }>>(`tenants?slug=eq.${encodeURIComponent(TENANT)}&select=id`);
  if (!tenant) throw new Error('tenant not found');
  const pricing = await rest<Pricing[]>('ai_pricing?select=provider,model,input_price_per_million,output_price_per_million,image_price_flat&active=eq.true');
  // Real sample: active products with a photo, spread over categories (deterministic).
  const products = await rest<Array<{ id: string; name: string; image_url: string; category_id: string | null }>>(
    `products?tenant_id=eq.${tenant.id}&active=eq.true&image_url=not.is.null&select=id,name,image_url,category_id&order=name.asc&limit=400`);
  const seen = new Set<string | null>();
  const sample: typeof products = [];
  for (const product of products) { if (!seen.has(product.category_id)) { seen.add(product.category_id); sample.push(product); } if (sample.length >= SAMPLE) break; }
  for (const product of products) { if (sample.length >= SAMPLE) break; if (!sample.includes(product)) sample.push(product); }

  const photos: Array<{ id: string; label: string; bytes: Buffer; mime: string; request: string | null }> = [];
  for (const [index, product] of sample.entries()) {
    const response = await fetch(product.image_url);
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    const mime = response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    const id = `photo-${String(index + 1).padStart(2, '0')}`;
    writeFileSync(`${OUT}/images/${id}-input.${ext(mime)}`, bytes);
    photos.push({ id, label: product.name, bytes, mime: ['image/jpeg', 'image/png', 'image/webp'].includes(mime) ? mime : 'image/jpeg', request: PHOTO_REQUESTS[index] || null });
  }
  const ideas = IDEAS.slice(0, SAMPLE).map((text, index) => ({ id: `idea-${String(index + 1).padStart(2, '0')}`, text }));

  // Blind labels: each model gets a random letter in the contact sheet.
  const letters = MODELS.map((_, index) => String.fromCharCode(65 + index)).sort(() => Math.random() - 0.5);
  const blind = Object.fromEntries(MODELS.map((m, index) => [`${m.provider}:${m.model}`, letters[index]!]));
  const results: Array<Record<string, unknown>> = [];

  for (const candidate of MODELS) {
    const key = `${candidate.provider}:${candidate.model}`;
    const price = pricing.find((row) => row.provider === candidate.provider && row.model === candidate.model);
    console.log(`\n== ${key}`);
    const run = async (task: 'photo' | 'prompt', id: string, prompt: string, input: { bytes: Buffer; mime: string } | null, step: 'initial' | 'correction') => {
      const result = await callModel(candidate.provider, candidate.model, prompt, input);
      const file = result.ok ? `images/${id}-${blind[key]}-${step}.${ext(result.mime!)}` : null;
      if (result.ok && file) writeFileSync(`${OUT}/${file}`, result.bytes!);
      results.push({
        model: key, blind: blind[key], task, sample: id, step, ok: result.ok, code: result.code ?? null, latencyMs: result.latencyMs,
        inputTokens: result.inputTokens ?? null, outputTokens: result.outputTokens ?? null, costUsd: result.ok ? cost(price, result) : 0,
        file, sha256: result.ok ? createHash('sha256').update(result.bytes!).digest('hex').slice(0, 16) : null,
      });
      console.log(`${task} ${id} ${step}: ${result.ok ? 'ok' : result.code} ${result.latencyMs} ms`);
      return result;
    };
    for (const photo of photos) {
      const first = await run('photo', photo.id, buildStudioPrompt({ origin: 'photo', style: DEFAULT_STUDIO_STYLE, request: photo.request, correction: null }), photo, 'initial');
      if (first.ok) await run('photo', photo.id, buildStudioPrompt({ origin: 'photo', style: DEFAULT_STUDIO_STYLE, request: photo.request, correction: CORRECTIONS.photo }), { bytes: first.bytes!, mime: first.mime! }, 'correction');
      if (first.code === 'missing_credential') break;
    }
    for (const idea of ideas) {
      const first = await run('prompt', idea.id, buildStudioPrompt({ origin: 'prompt', style: DEFAULT_STUDIO_STYLE, request: idea.text, correction: null }), null, 'initial');
      if (first.ok) await run('prompt', idea.id, buildStudioPrompt({ origin: 'prompt', style: DEFAULT_STUDIO_STYLE, request: idea.text, correction: CORRECTIONS.prompt }), { bytes: first.bytes!, mime: first.mime! }, 'correction');
      if (first.code === 'missing_credential') break;
    }
  }

  writeFileSync(`${OUT}/results.json`, JSON.stringify({ tenant: TENANT, sample: SAMPLE, models: MODELS, blind, photos: photos.map(({ id, label, request }) => ({ id, label, request })), ideas, corrections: CORRECTIONS, results }, null, 2));
  // Contact sheet: per sample, input then each blind letter (initial + correction).
  const rows = [...photos.map((p) => ({ id: p.id, title: `${p.label}${p.request ? ` · « ${p.request} »` : ''}`, input: true })), ...ideas.map((i) => ({ id: i.id, title: i.text, input: false }))];
  const sorted = [...new Set(Object.values(blind))].sort();
  const html = `<!doctype html><meta charset="utf-8"><title>Studio benchmark</title><style>body{font:14px system-ui;margin:16px}td{vertical-align:top;padding:4px}img{width:220px;height:220px;object-fit:contain;background:#eee}</style>
<h1>Studio images · benchmark (labels aveugles)</h1><p>Correction photo : « ${CORRECTIONS.photo} » · Correction idée : « ${CORRECTIONS.prompt} »</p>
<table>${rows.map((row) => `<tr><td colspan="9"><b>${row.id}</b> ${row.title}</td></tr><tr>${row.input ? `<td>Entrée<br><img src="images/${row.id}-input.${ext(photos.find((p) => p.id === row.id)!.mime)}"></td>` : ''}${sorted.map((letter) => ['initial', 'correction'].map((step) => {
    const r = results.find((x) => x.sample === row.id && x.blind === letter && x.step === step);
    return `<td>${letter} · ${step}<br>${r?.file ? `<img src="${r.file}">` : `<div style="width:220px">${r ? r.code : '—'}</div>`}</td>`;
  }).join('')).join('')}</tr>`).join('')}</table>`;
  writeFileSync(`${OUT}/contact-sheet.html`, html);
  const summary = MODELS.map((m) => {
    const key = `${m.provider}:${m.model}`;
    const rowsFor = (task: string) => results.filter((r) => r.model === key && r.task === task);
    const stats = (task: string) => {
      const all = rowsFor(task);
      const ok = all.filter((r) => r.ok);
      const lat = ok.map((r) => r.latencyMs as number).sort((a, b) => a - b);
      return { calls: all.length, ok: ok.length, p50Ms: lat[Math.floor(lat.length / 2)] ?? null, p90Ms: lat[Math.floor(lat.length * 0.9)] ?? null,
        costUsd: Math.round(ok.reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0) * 10_000) / 10_000, failures: all.filter((r) => !r.ok).map((r) => r.code) };
    };
    return { model: key, blind: blind[key], photo: stats('photo'), prompt: stats('prompt') };
  });
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
  console.log('\n' + JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
