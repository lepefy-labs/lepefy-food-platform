/**
 * scripts/generate-product-images.mjs
 * ChloeFood — Generazione immagini via Gemini AI
 * Eseguito dalla GitHub Action — nessun ambiente locale necessario
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import ws from 'ws';

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TENANT_SLUG    = 'chloefood';
const BUCKET         = 'assets';
const LIMIT          = parseInt(process.env.LIMIT ?? '0', 10);
const SKIP_EXISTING  = process.env.SKIP_EXISTING !== 'false';
const DELAY_MS       = 6500; // 10 RPM free tier → ~6.5s tra chiamate
const MAX_RETRIES    = 3;

// Validazione env vars
const missing = ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','GEMINI_API_KEY']
  .filter(k => !process.env[k]);
if (missing.length) {
  console.error('❌ Env vars mancanti:', missing.join(', '));
  process.exit(1);
}

// Fix Node.js 20: passa ws come transport a Supabase Realtime
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { transport: ws },
});
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ─── Prompt per categoria ─────────────────────────────────────────────────────

const CATEGORY_CONTEXT = {
  'epices':          'spice, seasoning or aromatic ingredient shown as powder, seeds or whole pieces in a small bowl',
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
    `an African and Cameroonian specialty food. ` +
    `It is a ${ctx}. ` +
    `Pure white background, soft studio lighting, sharp focus, ` +
    `3/4 angle or top-down view, clean appetizing presentation. ` +
    `No text, no watermark, no logo, no people. ` +
    `High resolution e-commerce product photo style.`
  );
}

// ─── Gemini: genera immagine ──────────────────────────────────────────────────

async function generateImage(name, categorySlug) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash-preview-image-generation',
    contents: buildPrompt(name, categorySlug),
    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
  });

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, 'base64');
    }
  }
  throw new Error('Nessuna immagine nella risposta Gemini');
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function getProducts() {
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('slug', TENANT_SLUG).single();
  if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' non trovato`);

  let query = supabase
    .from('products')
    .select('id, name, slug, image_url, categories(slug)')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('position');

  if (SKIP_EXISTING) query = query.is('image_url', null);
  if (LIMIT > 0)     query = query.limit(LIMIT);

  const { data, error } = await query;
  if (error) throw new Error(`Lettura prodotti: ${error.message}`);

  return (data ?? []).map(p => ({
    id:           p.id,
    name:         p.name,
    slug:         p.slug,
    categorySlug: p.categories?.slug ?? 'epices',
  }));
}

async function uploadAndUpdate(product, imageBuffer) {
  const path = `products/${product.slug}.jpg`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, imageBuffer, { contentType: 'image/jpeg', upsert: true });
  if (upErr) throw new Error(`Storage: ${upErr.message}`);

  const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  const { error: dbErr } = await supabase
    .from('products')
    .update({ image_url: imageUrl })
    .eq('id', product.id);
  if (dbErr) throw new Error(`DB update: ${dbErr.message}`);

  return imageUrl;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad   = (n, total) => String(n).padStart(String(total).length, ' ');

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
    console.log('✅ Nessun prodotto da processare (tutti hanno già image_url).');
    writeFileSync('scripts/image-generation-log.csv', 'slug,name,category,status,image_url,error\n');
    return;
  }
  console.log(`📦 ${products.length} prodotti da processare\n`);

  const log = [];
  let ok = 0, fail = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const prefix = `[${pad(i+1, products.length)}/${products.length}]`;
    console.log(`${prefix} ${p.slug}`);
    console.log(`${''.padStart(prefix.length + 1)}${p.name} (${p.categorySlug})`);

    let status = 'failed', imageUrl = '', errorMsg = '';
    let imageBuffer = null;

    // Genera con retry
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

    // Upload + DB update
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

  // ─── Report finale ────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════');
  console.log(`✅ Successo : ${ok}/${products.length}`);
  if (fail > 0) console.log(`❌ Falliti  : ${fail} — scarica il CSV dagli artefatti del run`);

  // ─── Salva CSV ────────────────────────────────────────────────────────────
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
