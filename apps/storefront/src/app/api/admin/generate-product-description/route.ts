import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

// ─── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(
  locales:            string[],
  productName:        string,
  categoryName:        string,
  ingredientsText?:   string,
  usageInstructions?: string,
): string {
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

/** Construit un responseSchema JSON dynamique : un objet avec une propriété
 * string requise pour chaque locale du tenant. */
function buildResponseSchema(locales: string[]) {
  return {
    type:       Type.OBJECT,
    properties: Object.fromEntries(locales.map((l) => [l, { type: Type.STRING }])),
    required:   locales,
  };
}

/** Extrait le payload JSON d'une réponse Gemini qui peut contenir des fences
 * markdown ou du texte de contour autour de l'objet JSON. */
function extractJsonPayload(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1).trim();
  }
  return raw.trim();
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

  if (!tenant.ai_description_generation) {
    return NextResponse.json(
      { error: 'Génération IA des descriptions non activée pour ce tenant' },
      { status: 403 },
    );
  }

  const body = await req.json();
  const {
    productId,
    productName,
    categoryName,
    ingredientsText,
    usageInstructions,
  } = body as {
    productId:          string;
    productName:        string;
    categoryName?:      string;
    ingredientsText?:   string;
    usageInstructions?: string;
  };

  if (!productId || !productName) {
    return NextResponse.json(
      { error: 'Champs requis manquants: productId, productName' },
      { status: 400 },
    );
  }

  const locales = tenant.locales ?? [];
  if (locales.length === 0) {
    return NextResponse.json(
      { error: 'Aucune langue configurée pour ce tenant' },
      { status: 500 },
    );
  }

  try {
    console.log(`[generate-description] Génération pour "${productName}" (${locales.join(', ')})`);

    const prompt = buildPrompt(
      locales,
      productName,
      categoryName ?? '',
      ingredientsText,
      usageInstructions,
    );

    const response = await ai.models.generateContent({
      model:    'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature:      0.6,
        maxOutputTokens:  1024, // margine ampio pour N langues x 2-4 phrases chacune
        responseMimeType: 'application/json',
        responseSchema:   buildResponseSchema(locales),
      },
    });

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!raw.trim()) throw new Error('Gemini n\'a généré aucune description');

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(extractJsonPayload(raw));
    } catch {
      console.error(
        '[generate-description] JSON non parsable. Réponse brute Gemini:',
        raw.slice(0, 2000),
      );
      throw new Error('Réponse IA invalide (JSON non parsable)');
    }

    const descriptions: Record<string, string> = {};
    for (const locale of locales) {
      const value = parsed[locale];
      if (typeof value !== 'string' || !value.trim()) {
        console.error(`[generate-description] Langue manquante dans la réponse IA: ${locale}`, parsed);
        throw new Error(`Langue manquante dans la réponse IA: ${locale}`);
      }
      descriptions[locale] = value.trim();
    }

    console.log(`[generate-description] Terminé pour "${productName}"`);

    return NextResponse.json({ descriptions });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[generate-description] Erreur:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
