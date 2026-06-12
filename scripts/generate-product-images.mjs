/**
 * scripts/generate-product-images.mjs
 * ChloeFood — Generazione immagini via Gemini AI
 * Usa fetch nativo per Supabase REST API — nessuna dipendenza da ws/Realtime
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { writeFileSync } from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TENANT_SLUG    = 'chloefood';
const BUCKET         = 'assets';
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

async function sbUpload(storagePath, buffer, contentType) {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
    {
      method: 'POST',
      headers: {
        'apikey':          SUPABASE_KEY,
        'Authorization':   `Bearer ${SUPABASE_KEY}`,
        'Content-Type':    contentType,
        'x-upsert':        'true',
      },
      body: buffer,
    }
  );
  if (!res.ok) throw new Error(`Storage upload: ${res.status} ${await res.text()}`);
}

// ─── Lettura prodotti ─────────────────────────────────────────────────────────

async function getProducts() {
  // 1. Tenant id
  const tenants = await sbGet(`tenants?slug=eq.${TENANT_SLUG}&select=id`);
  if (!tenants.length) throw new Error(`Tenant '${TENANT_SLUG}' non trovato`);
  const tenantId = tenants[0].id;

  // 2. Prodotti con categoria
  let url = `products?tenant_id=eq.${tenantId}&active=eq.true&select=id,name,slug,image_url,category_id,categories(slug)&order=position`;
  if (SKIP_EXISTING) url += '&image_url=is.null';
  if (LIMIT > 0)     url += `&limit=${LIMIT}`;

  const products = await sbGet(url);
  return products.map(p => ({
    id:           p.id,
    name:         p.name,
    slug:         p.slug,
    categorySlug: p.categories?.slug ?? 'epices',
  }));
}

// ─── Upload + aggiornamento DB ────────────────────────────────────────────────

async function uploadAndUpdate(product, imageBuffer) {
  const storagePath = `products/${product.slug}.jpg`;
  await sbUpload(storagePath, imageBuffer, 'image/jpeg');

  const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
  await sbPatch(
    `products?id=eq.${product.id}`,
    { image_url: imageUrl }
  );
  return imageUrl;
}

// ─── Gemini image generation ──────────────────────────────────────────────────

const CATEGORY_CONTEXT = {
  'epices':          'spice or seasoning shown as powder, seeds or whole pieces in a small bowl',
  'legumes':         'fresh or frozen vegetable, leaf, root or legume typical of African cuisine',
  'farines':         'starchy food, flour, fufu or wrapped dough typical of Central African cuisine',
  'poissons':        'dried, smoked or salted fish or seafood typical of African markets',
  'sauces-huiles':   'cooking oil, sauce or paste in a jar, bottle or bowl',
  'snacks':          'roasted nuts, sweet snack or packaged African treat',
  'viandes-sechees': 'dried cured meat, jerky-style African product called kilishi',
  'boissons':        'beverage bottle or can, African beer or tropical juice drink',
};

function buildPrompt(name, categorySlug) {
  const ctx = CATEGORY_CONTEXT[categorySlug] ?? 'African specialty food product';
  return (
    `Professional studio food photography of "${name}", ` +
    `an African and Cameroonian specialty food. It is a ${ctx}. ` +
    `Pure white background, soft studio lighting, sharp focus, ` +
    `3/4 angle or top-down view, clean appetizing presentation. ` +
    `No text, no watermark, no logo, no people. ` +
    `High resolution e-commerce product photo style.`
  );
}

async function generateImage(name, categorySlug) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: buildPrompt(name, categorySlug),
    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
  });
  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData?.data) return Buffer.from(part.inlineData.data, 'base64');
  }
  throw new Error('Nessuna immagine nella risposta Gemini');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad   = (n, t) => String(n).padStart(String(t).length, ' ');

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   ChloeFood — Generazione immagini Gemini AI    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Skip esistenti : ${SKIP_EXISTING}`);
  console.log(`Limite         : ${LIMIT === 0 ? 'nessuno (tutti)' : LIMIT}`);
  console.log('');

  const products = await getProducts();
  if (products.length === 0) {
    console.log('✅ Nessun prodotto da processare.');
    writeFileSync('scripts/image-generation-log.csv', 'slug,name,category,status,image_url,error\n');
    return;
  }
  console.log(`📦 ${products.length} prodotti da processare\n`);

  const log = [];
  let ok = 0, fail = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    console.log(`[${pad(i+1, products.length)}/${products.length}] ${p.slug}`);
    console.log(`         ${p.name} (${p.categorySlug})`);

    let status = 'failed', imageUrl = '', errorMsg = '';
    let imageBuffer = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const label = attempt > 1 ? ` — retry ${attempt}/${MAX_RETRIES}` : '';
        process.stdout.write(`         → Gemini${label}... `);
        imageBuffer = await generateImage(p.name, p.categorySlug);
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

    if (imageBuffer) {
      try {
        process.stdout.write('         → Upload + DB... ');
        imageUrl = await uploadAndUpdate(p, imageBuffer);
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

    log.push({ slug: p.slug, name: p.name, category: p.categorySlug,
               status, image_url: imageUrl, error: errorMsg });
    console.log('');

    if (i < products.length - 1) await sleep(DELAY_MS);
  }

  console.log('══════════════════════════════════════════════════');
  console.log(`✅ Successo : ${ok}/${products.length}`);
  if (fail > 0) console.log(`❌ Falliti  : ${fail} — scarica il CSV dagli artefatti del run`);

  const csv = 'slug,name,category,status,image_url,error\n' +
    log.map(r =>
      [r.slug, `"${r.name}"`, r.category, r.status, r.image_url, `"${r.error}"`].join(',')
    ).join('\n');
  writeFileSync('scripts/image-generation-log.csv', csv, 'utf8');
  console.log('📄 Log CSV salvato → disponibile negli artefatti del workflow');
}

main().catch(err => {
  console.error('\n💥 Errore fatale:', err.message);
  process.exit(1);
});
