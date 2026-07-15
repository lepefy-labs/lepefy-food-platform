/**
 * scripts/generate-product-embeddings.mjs
 * Lepefy Food — Generazione embedding prodotto (ricerca semantica) via Gemini AI
 * Usa fetch nativo per Supabase REST API — nessuna dipendenza da ws/Realtime
 */

import { GoogleGenAI } from '@google/genai';
import { writeFileSync } from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TENANT_SLUG    = process.env.TENANT_SLUG ?? 'chloefood';
const LIMIT          = parseInt(process.env.LIMIT ?? '0', 10);
const SKIP_EXISTING  = process.env.SKIP_EXISTING !== 'false';
const DELAY_MS       = 500; // quota embedding molto più alta della image generation
const MAX_RETRIES    = 3;
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 768;

const missing = ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','GEMINI_API_KEY']
  .filter(k => !process.env[k]);
if (missing.length) {
  console.error('❌ Env vars mancanti:', missing.join(', '));
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ─── Supabase REST helpers (fetch puro, no SDK) ───────────────────────────────

const SB_HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ...SB_HEADERS, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${path}: ${res.status} ${await res.text()}`);
}

// ─── Tracking costi AI (best-effort, pas de rate limit ici — batch admin) ──────

async function logAiUsage({
  tenantId,
  endpoint,
  provider,
  model,
  inputTokens = null,
  outputTokens = null,
  imagesGenerated = 0,
  status,
}) {
  try {
    const pricing = await sbGet(
      `ai_pricing?provider=eq.${provider}&model=eq.${model}&active=eq.true&select=input_price_per_million,output_price_per_million,image_price_flat`
    );
    const price = pricing[0] ?? {};

    const inputCost  = inputTokens  && price.input_price_per_million
      ? (inputTokens  / 1_000_000) * price.input_price_per_million  : 0;
    const outputCost = outputTokens && price.output_price_per_million
      ? (outputTokens / 1_000_000) * price.output_price_per_million : 0;
    const imageCost  = imagesGenerated && price.image_price_flat
      ? imagesGenerated * price.image_price_flat : 0;

    const estimatedCostUsd = inputCost + outputCost + imageCost;

    await fetch(`${SUPABASE_URL}/rest/v1/ai_usage_log`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        tenant_id: tenantId,
        endpoint,
        provider,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        images_generated: imagesGenerated,
        estimated_cost_usd: estimatedCostUsd,
        status,
      }),
    });
  } catch (err) {
    // Best-effort: il logging non deve mai interrompere il batch
    console.error('[ai-usage-log] Erreur enregistrement usage (ignorée):', err.message);
  }
}

// ─── Lettura tenant + prodotti ─────────────────────────────────────────────────

async function getTenant() {
  const tenants = await sbGet(`tenants?slug=eq.${TENANT_SLUG}&select=id,ai_semantic_search`);
  if (!tenants.length) throw new Error(`Tenant '${TENANT_SLUG}' non trovato`);
  return tenants[0];
}

async function getProducts(tenantId) {
  // LIMIT applicato in JS dopo il filtro skip_existing, mai a livello di
  // query REST — stesso fix già applicato a generate-product-descriptions.mjs
  // (limitare lato query tronca ai primi N prodotti per position PRIMA del
  // filtro, che può scartarli tutti se hanno già un embedding).
  const url = `products?tenant_id=eq.${tenantId}&active=eq.true&select=id,name,slug,descriptions,category_id,embedding,categories(name)&order=position`;

  const allProducts = await sbGet(url);
  console.log(`📦 Prodotti totali attivi tenant: ${allProducts.length}`);

  const filtered = SKIP_EXISTING
    ? allProducts.filter(p => p.embedding == null)
    : allProducts;
  console.log(`📦 Prodotti dopo filtro skip_existing: ${filtered.length}`);

  const limited = LIMIT > 0 ? filtered.slice(0, LIMIT) : filtered;

  return limited.map(p => ({
    id:           p.id,
    name:         p.name,
    slug:         p.slug,
    categoryName: p.categories?.name ?? null,
    descriptions: p.descriptions ?? null,
  }));
}

// ─── Testo da embeddare — IDENTICO a buildProductEmbeddingText della route API

function buildProductEmbeddingText(p) {
  const parts = [p.name];
  if (p.categoryName) parts.push(p.categoryName);
  if (p.descriptions) {
    for (const text of Object.values(p.descriptions)) {
      if (text && text.trim()) parts.push(text.trim());
    }
  }
  return parts.join('\n');
}

// ─── Gemini embedding ───────────────────────────────────────────────────────────

async function embedProduct(product) {
  const text = buildProductEmbeddingText(product);

  const response = await ai.models.embedContent({
    model:    EMBEDDING_MODEL,
    contents: text,
    config: {
      outputDimensionality: EMBEDDING_DIMENSIONS,
    },
  });

  const embedding = response.embeddings?.[0];
  const vector = embedding?.values;
  if (!vector || vector.length === 0) {
    throw new Error('Gemini non ha restituito alcun embedding');
  }

  // statistics.tokenCount è riservato a Gemini Enterprise in questa versione
  // SDK — fallback su stima approssimativa se assente.
  const tokenCount = embedding.statistics?.tokenCount ?? Math.ceil(text.length / 4);

  return { vector, tokenCount };
}

// ─── Aggiornamento DB ───────────────────────────────────────────────────────────

async function updateProduct(product, vector) {
  await sbPatch(
    `products?id=eq.${product.id}`,
    { embedding: vector }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad   = (n, t) => String(n).padStart(String(t).length, ' ');

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Lepefy Food — Génération embeddings Gemini AI   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Tenant         : ${TENANT_SLUG}`);
  console.log(`Skip esistenti : ${SKIP_EXISTING}`);
  console.log(`Limite         : ${LIMIT === 0 ? 'nessuno (tutti)' : LIMIT}`);
  console.log('');

  const tenant = await getTenant();
  if (!tenant.ai_semantic_search) {
    console.error(`❌ Recherche sémantique non activée pour le tenant '${TENANT_SLUG}'`);
    process.exit(1);
  }

  const products = await getProducts(tenant.id);
  if (products.length === 0) {
    console.log('✅ Nessun prodotto da processare.');
    writeFileSync('scripts/embedding-generation-log.csv', 'slug,name,status,error\n');
    return;
  }
  console.log(`📦 ${products.length} prodotti da processare\n`);

  const log = [];
  let ok = 0, fail = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    console.log(`[${pad(i+1, products.length)}/${products.length}] ${p.slug}`);
    console.log(`         ${p.name}`);

    let status = 'failed', errorMsg = '';
    let result = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const label = attempt > 1 ? ` — retry ${attempt}/${MAX_RETRIES}` : '';
        process.stdout.write(`         → Gemini${label}... `);
        result = await embedProduct(p);
        console.log('✓');
        break;
      } catch (err) {
        console.log(`✗  ${err.message}`);
        if (attempt < MAX_RETRIES) {
          const wait = Math.pow(2, attempt) * 5000;
          console.log(`         → Attesa ${wait/1000}s...`);
          await sleep(wait);
        } else {
          errorMsg = err.message;
        }
      }
    }

    // Tracking costi : une ligne par produit reflétant le dernier essai
    // d'embedding, indépendamment du résultat de l'écriture DB.
    await logAiUsage({
      tenantId:     tenant.id,
      endpoint:     'generate-product-embeddings-batch',
      provider:     'gemini',
      model:        EMBEDDING_MODEL,
      inputTokens:  result ? result.tokenCount : null,
      outputTokens: 0,
      status:       result ? 'success' : 'error',
    });

    if (result) {
      try {
        process.stdout.write('         → Aggiornamento DB... ');
        await updateProduct(p, result.vector);
        console.log('✓');
        status = 'success';
        ok++;
      } catch (err) {
        console.log(`✗  ${err.message}`);
        errorMsg = err.message;
        fail++;
      }
    } else {
      fail++;
    }

    log.push({ slug: p.slug, name: p.name, status, error: errorMsg });
    console.log('');

    if (i < products.length - 1) await sleep(DELAY_MS);
  }

  console.log('══════════════════════════════════════════════════');
  console.log(`✅ Successo : ${ok}/${products.length}`);
  if (fail > 0) console.log(`❌ Falliti  : ${fail} — scarica il CSV dagli artefatti del run`);

  const csv = 'slug,name,status,error\n' +
    log.map(r =>
      [r.slug, `"${r.name}"`, r.status, `"${r.error}"`].join(',')
    ).join('\n');
  writeFileSync('scripts/embedding-generation-log.csv', csv, 'utf8');
  console.log('📄 Log CSV salvato → disponibile negli artefatti del workflow');
}

main().catch(err => {
  console.error('\n💥 Errore fatale:', err.message);
  process.exit(1);
});
