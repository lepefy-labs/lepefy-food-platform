import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Modality } from '@google/genai';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { checkRateLimit, logAiUsage } from '@/lib/ai/usageTracking';

const ENDPOINT = 'generate-product-image';

// ⚠️  NOTA VERCEL: la generazione AI richiede 5-15s.
// Con piano Free (timeout 10s) può andare in timeout.
// Con piano Pro impostare maxDuration = 60.
// In caso di timeout il frontend riceve un errore gestito.
export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

// ─── Step 1: genera prompt fotografico dettagliato ────────────────────────────

async function generatePhotoPrompt(
  productName: string,
  categorySlug: string,
  categoryName: string,
): Promise<string> {
  const categoryContext: Record<string, string> = {
    'epices':
      'African spice or seasoning. Describe its exact color, texture ' +
      '(powder, seeds, or whole pieces), and any distinctive visual details.',
    'legumes':
      'Fresh or frozen African vegetable, leaf, or root. Describe its ' +
      'color, texture, shape, and how it typically looks when sold.',
    'farines':
      'African starchy food, flour, or wrapped dough product like fufu, ' +
      'bobolo, or chikwang. Describe its color, wrapping, and presentation.',
    'poissons':
      'Dried, smoked, or salted African fish or seafood. Describe its ' +
      'color, texture, size, and typical market presentation.',
    'sauces-huiles':
      'African cooking oil, sauce, or paste. Describe its color, ' +
      'consistency, and how it looks in a jar or bottle.',
    'snacks':
      'African roasted nuts, seeds, or sweet treat. Describe its ' +
      'color, texture, and typical serving presentation.',
    'viandes-sechees':
      'African dried or cured meat product. Describe its color, ' +
      'texture, and visual characteristics.',
    'boissons':
      'African beverage in a bottle or can. Describe the packaging ' +
      'color, label style, and liquid appearance if visible.',
  };

  const ctx = categoryContext[categorySlug]
    ?? 'African specialty food product. Describe its visual appearance.';

  const systemPrompt = `You are an expert food stylist and professional
photographer specializing in African cuisine, particularly Cameroonian
and Central/West African products. Your task is to write detailed,
accurate visual descriptions for food photography prompts.

When given a product name and category, you must:
1. Identify the exact product based on your knowledge of African food
2. Describe its precise visual characteristics (color, texture, shape, size)
3. Output ONLY the photography prompt in English, nothing else
4. Never invent visual details you are not sure about — use generic
   but accurate descriptions instead`;

  const userMessage = `Product name: "${productName}"
Category: ${categoryName} (${categorySlug})
Context: ${ctx}

Write a professional food photography prompt for this product that will
be used to generate a commercial e-commerce image. The prompt must:
- Start with "A professional studio food photography shot of"
- Include accurate visual details specific to this African product
- Specify: pure white background, soft studio lighting, sharp focus,
  3/4 angle view, commercial e-commerce style, high resolution
- Be between 60 and 120 words
- Output ONLY the prompt text, no explanations, no quotes`;

  const response = await ai.models.generateContent({
    model:    'gemini-2.5-flash',
    contents: userMessage,
    config: {
      systemInstruction: systemPrompt,
      temperature:       0.4,
      maxOutputTokens:   300,
    },
  });

  const prompt = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!prompt.trim()) throw new Error('Flash non ha generato un prompt');
  return prompt.trim();
}

// ─── Step 2: genera immagine dal prompt ───────────────────────────────────────

interface ImageGenerationResult {
  base64Data: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

async function generateImage(photoPrompt: string): Promise<ImageGenerationResult> {
  const models = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: photoPrompt,
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          return {
            base64Data:   part.inlineData.data,
            model,
            inputTokens:  response.usageMetadata?.promptTokenCount,
            outputTokens: response.usageMetadata?.candidatesTokenCount,
          };
        }
      }
    } catch (err) {
      console.error(`[generate-image] Modello ${model} fallito:`, err);
      if (model === models[models.length - 1]) throw err;
      continue;
    }
  }

  throw new Error("Nessun modello ha generato un'immagine");
}

// ─── Upload su Supabase Storage ───────────────────────────────────────────────

async function uploadToStorage(
  base64Data: string,
  slug: string,
): Promise<string> {
  const supabase = createServiceClient();
  const buffer   = Buffer.from(base64Data, 'base64');
  const path     = `products/${slug}-ai.jpg`;

  const { error } = await supabase.storage
    .from('assets')
    .upload(path, buffer, {
      contentType: 'image/jpeg',
      upsert:      true,
    });

  if (error) throw new Error(`Storage upload: ${error.message}`);

  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/${path}`;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY non configurata' },
      { status: 500 },
    );
  }

  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  if (!tenant.ai_image_generation) {
    return NextResponse.json(
      { error: 'Génération IA non activée pour ce tenant' },
      { status: 403 },
    );
  }

  const body = await req.json();
  const {
    productId,
    productName,
    categorySlug,
    categoryName,
    productSlug,
  } = body as {
    productId:    string;
    productName:  string;
    categorySlug: string;
    categoryName: string;
    productSlug:  string;
  };

  if (!productName || !productId || !productSlug) {
    return NextResponse.json(
      { error: 'Champs requis manquants: productId, productName, productSlug' },
      { status: 400 },
    );
  }

  const allowed = await checkRateLimit(tenant.id, ENDPOINT, false);
  if (!allowed) {
    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'gemini',
      model:    'gemini-2.5-flash-image',
      status:   'rate_limited',
    });
    return NextResponse.json(
      { error: 'Limite quotidien de générations IA atteint pour ce tenant. Réessayez demain.' },
      { status: 429 },
    );
  }

  try {
    console.log(`[generate-image] Step 1: generazione prompt per "${productName}"`);
    const photoPrompt = await generatePhotoPrompt(
      productName,
      categorySlug ?? '',
      categoryName ?? categorySlug ?? '',
    );
    console.log(`[generate-image] Prompt generato: ${photoPrompt.slice(0, 100)}...`);

    console.log('[generate-image] Step 2: generazione immagine');
    const { base64Data, model, inputTokens, outputTokens } = await generateImage(photoPrompt);

    console.log('[generate-image] Step 3: upload su Supabase Storage');
    const imageUrl = await uploadToStorage(base64Data, productSlug);

    const supabase = createServiceClient();
    await supabase
      .from('products')
      .update({ image_url: imageUrl })
      .eq('id', productId)
      .eq('tenant_id', tenant.id);

    console.log(`[generate-image] Completato: ${imageUrl}`);

    // Coût dominant = l'étape image (step 1 avec gemini-2.5-flash n'est pas
    // tracké séparément — coût marginal comparé à la génération d'image).
    await logAiUsage({
      tenantId:        tenant.id,
      endpoint:        ENDPOINT,
      provider:        'gemini',
      model,
      inputTokens,
      outputTokens,
      imagesGenerated: 1,
      status:          'success',
    });

    return NextResponse.json({
      imageUrl,
      prompt:    photoPrompt,
      simulated: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[generate-image] Errore:', message);
    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'gemini',
      model:    'gemini-2.5-flash-image',
      status:   'error',
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
