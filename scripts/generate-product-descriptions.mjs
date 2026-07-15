/**
 * scripts/generate-product-descriptions.mjs
 * Lepefy Food — Generazione descrizioni prodotto multilingue via Gemini AI
 * Usa fetch nativo per Supabase REST API — nessuna dipendenza da ws/Realtime
 */

import { GoogleGenAI, Type } from '@google/genai';
import { writeFileSync } from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TENANT_SLUG    = process.env.TENANT_SLUG ?? 'chloefood';
const LIMIT          = parseInt(process.env.LIMIT ?? '0', 10);
const SKIP_EXISTING  = process.env.SKIP_EXISTING !== 'false';
const DELAY_MS       = 6500;
const MAX_RETRIES    = 3;

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

// ─── Lettura tenant + prodotti ─────────────────────────────────────────────────

async function getTenant() {
  const tenants = await sbGet(`tenants?slug=eq.${TENANT_SLUG}&select=id,locales,ai_description_generation`);
  if (!tenants.length) throw new Error(`Tenant '${TENANT_SLUG}' non trovato`);
  return tenants[0];
}

async function getProducts(tenantId) {
  let url = `products?tenant_id=eq.${tenantId}&active=eq.true&select=id,name,slug,description,descriptions,ingredients_text,usage_instructions,category_id,categories(name)&order=position`;
  if (LIMIT > 0) url += `&limit=${LIMIT}`;

  const products = await sbGet(url);
  const filtered = SKIP_EXISTING
    ? products.filter(p => !p.descriptions || Object.keys(p.descriptions).length === 0)
    : products;

  return filtered.map(p => ({
    id:                 p.id,
    name:               p.name,
    slug:               p.slug,
    categoryName:       p.categories?.name ?? '',
    ingredientsText:    p.ingredients_text ?? '',
    usageInstructions:  p.usage_instructions ?? '',
  }));
}

// ─── Prompt builder — IDENTICO a quello della route API ────────────────────────

function buildPrompt(locales, productName, categoryName, ingredientsText, usageInstructions) {
  const localesList = locales.map((l) => `"${l}"`).join(', ');
  const jsonExample = locales
    .map((l) => `"${l}": "..."`)
    .join(', ');

  return `Tu es un rédacteur e-commerce spécialisé dans les produits alimentaires
africains et camerounais, vendus en Europe sur une boutique en ligne.

Produit : "${productName}"
Catégorie : ${categoryName}
${ingredientsText ? `Ingrédients (information fournie) : ${ingredientsText}` : ''}
${usageInstructions ? `Usage culinaire (information fournie) : ${usageInstructions}` : ''}

Rédige une description produit pour CHACUNE des langues suivantes : ${localesList}.
Pour chaque langue :
- 2 à 4 phrases, ton chaleureux et appétissant
- Inclure le contexte culturel et l'usage culinaire typique si le produit est connu
- Description sensorielle (goût, texture, arôme) et d'usage uniquement

GARDE-FOUS STRICTS — ne jamais mentionner :
- Les allergènes
- Les allégations nutritionnelles ou de santé ("sans gluten", "riche en protéines",
  "bon pour la santé", etc.)
- Une origine géographique qui n'est pas fournie explicitement dans les données ci-dessus
- Des valeurs nutritionnelles
- Des références à des lots ou des dates de péremption
N'invente aucune information sur la composition ou la provenance du produit.

Réponds UNIQUEMENT avec un objet JSON, sans balises markdown, sans backticks,
avec exactement ces clés : {${jsonExample}}`;
}

/** Costruisce un responseSchema JSON dinamico: un oggetto con una proprietà
 * stringa richiesta per ogni locale del tenant. */
function buildResponseSchema(locales) {
  return {
    type:       Type.OBJECT,
    properties: Object.fromEntries(locales.map((l) => [l, { type: Type.STRING }])),
    required:   locales,
  };
}

/** Estrae il payload JSON da una risposta Gemini che può contenere fence
 * markdown o testo di contorno attorno all'oggetto JSON. */
function extractJsonPayload(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1).trim();
  }
  return raw.trim();
}

async function generateDescriptions(locales, product) {
  const prompt = buildPrompt(
    locales,
    product.name,
    product.categoryName,
    product.ingredientsText,
    product.usageInstructions,
  );

  const response = await ai.models.generateContent({
    model:    'gemini-2.5-flash',
    contents: prompt,
    config: {
      temperature:      0.6,
      maxOutputTokens:  4096, // margine ampio: include i token di "thinking" del modello + testo finale multilingua
      thinkingConfig:   { thinkingBudget: 0 }, // 2-4 frasi per lingua non richiede ragionamento esteso
      responseMimeType: 'application/json',
      responseSchema:   buildResponseSchema(locales),
    },
  });

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw.trim()) throw new Error('Gemini non ha generato alcuna descrizione');

  let parsed;
  try {
    parsed = JSON.parse(extractJsonPayload(raw));
  } catch {
    const finishReason = response.candidates?.[0]?.finishReason;
    console.error(`[generate-description] JSON non parsable (finishReason: ${finishReason}). Risposta grezza Gemini:`, raw.slice(0, 2000));
    throw new Error('Réponse IA invalide (JSON non parsable)');
  }

  const descriptions = {};
  for (const locale of locales) {
    const value = parsed[locale];
    if (typeof value !== 'string' || !value.trim()) {
      console.error(`[generate-description] Langue manquante dans la réponse IA: ${locale}`, parsed);
      throw new Error(`Langue manquante dans la réponse IA: ${locale}`);
    }
    descriptions[locale] = value.trim();
  }
  return descriptions;
}

// ─── Aggiornamento DB ───────────────────────────────────────────────────────────

async function updateProduct(product, descriptions, firstLocale) {
  await sbPatch(
    `products?id=eq.${product.id}`,
    {
      descriptions,
      description_source: 'ai',
      description:         descriptions[firstLocale] ?? null,
    }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad   = (n, t) => String(n).padStart(String(t).length, ' ');

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Lepefy Food — Génération descriptions Gemini AI ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Tenant         : ${TENANT_SLUG}`);
  console.log(`Skip esistenti : ${SKIP_EXISTING}`);
  console.log(`Limite         : ${LIMIT === 0 ? 'nessuno (tutti)' : LIMIT}`);
  console.log('');

  const tenant = await getTenant();
  if (!tenant.ai_description_generation) {
    console.error(`❌ Génération IA des descriptions non activée pour le tenant '${TENANT_SLUG}'`);
    process.exit(1);
  }

  const locales = tenant.locales ?? [];
  if (locales.length === 0) {
    console.error(`❌ Aucune langue configurée pour le tenant '${TENANT_SLUG}'`);
    process.exit(1);
  }
  console.log(`Langues        : ${locales.join(', ')}\n`);

  const products = await getProducts(tenant.id);
  if (products.length === 0) {
    console.log('✅ Nessun prodotto da processare.');
    writeFileSync('scripts/description-generation-log.csv', 'slug,name,status,error\n');
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
    let descriptions = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const label = attempt > 1 ? ` — retry ${attempt}/${MAX_RETRIES}` : '';
        process.stdout.write(`         → Gemini${label}... `);
        descriptions = await generateDescriptions(locales, p);
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

    if (descriptions) {
      try {
        process.stdout.write('         → Aggiornamento DB... ');
        await updateProduct(p, descriptions, locales[0]);
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
  writeFileSync('scripts/description-generation-log.csv', csv, 'utf8');
  console.log('📄 Log CSV salvato → disponibile negli artefatti del workflow');
}

main().catch(err => {
  console.error('\n💥 Errore fatale:', err.message);
  process.exit(1);
});
