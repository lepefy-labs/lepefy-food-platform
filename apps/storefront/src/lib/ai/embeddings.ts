import { GoogleGenAI } from '@google/genai';
import { createServiceClient } from '@/lib/supabase/server';
import { logAiUsage } from '@/lib/ai/usageTracking';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 768;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY non configurata');
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

/**
 * Calcule l'embedding d'un texte via gemini-embedding-001 (768 dimensions).
 * `tokenCount` provient de `statistics.tokenCount` quand disponible (réservé
 * à Gemini Enterprise dans cette version du SDK) ; sinon estimation
 * approximative `Math.ceil(text.length / 4)`.
 */
export async function embedText(text: string): Promise<{ vector: number[]; tokenCount: number | null }> {
  const ai = getClient();

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
    throw new Error('Gemini n\'a retourné aucun embedding');
  }

  const tokenCount = embedding.statistics?.tokenCount ?? Math.ceil(text.length / 4);

  return { vector, tokenCount };
}

/**
 * Embeds several short queries in one provider request. Cart Builder uses this
 * to avoid one embedding request per ingredient.
 */
export async function embedTexts(texts: string[]): Promise<{
  vectors: number[][];
  tokenCount: number;
}> {
  if (texts.length === 0) return { vectors: [], tokenCount: 0 };
  const response = await getClient().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: {
      outputDimensionality: EMBEDDING_DIMENSIONS,
    },
  });

  const embeddings = response.embeddings ?? [];
  if (embeddings.length !== texts.length) {
    throw new Error('Gemini n\'a pas retourné tous les embeddings');
  }

  const vectors = embeddings.map((embedding) => {
    if (!embedding.values?.length) throw new Error('Gemini n\'a retourné aucun embedding');
    return embedding.values;
  });
  const tokenCount = embeddings.reduce(
    (sum, embedding, index) => sum + (embedding.statistics?.tokenCount ?? Math.ceil((texts[index]?.length ?? 0) / 4)),
    0,
  );
  return { vectors, tokenCount };
}

/**
 * Construit le texte à embedder pour un produit : nom + catégorie + toutes
 * les descriptions présentes (toutes langues, jamais hardcodées).
 */
export function buildProductEmbeddingText(p: {
  name: string;
  categoryName?: string | null;
  descriptions?: Record<string, string> | null;
}): string {
  const parts: string[] = [p.name];

  if (p.categoryName) parts.push(p.categoryName);

  if (p.descriptions) {
    for (const text of Object.values(p.descriptions)) {
      if (text && text.trim()) parts.push(text.trim());
    }
  }

  return parts.join('\n');
}

/**
 * Recalcule et persiste l'embedding d'un produit après un enregistrement
 * réussi (création ou modification). Best-effort : n'importe quelle erreur
 * ici est loguée avec le préfixe [embed-sync] mais ne remonte jamais à
 * l'appelant — le salvataggio produit ne doit jamais dépendre de ceci.
 * Le tentative est toujours enregistrée dans ai_usage_log, sans rate limit
 * (action admin liée à un enregistrement, pas un endpoint public).
 */
export async function syncProductEmbedding(tenantId: string, productId: string): Promise<void> {
  const supabase = createServiceClient();

  try {
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('name, category_id, descriptions')
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .single();

    if (productError || !product) {
      throw new Error(productError?.message ?? 'Produit introuvable');
    }

    let categoryName: string | null = null;
    if (product.category_id) {
      const { data: category } = await supabase
        .from('categories')
        .select('name')
        .eq('id', product.category_id)
        .maybeSingle();
      categoryName = category?.name ?? null;
    }

    const text = buildProductEmbeddingText({
      name:         product.name,
      categoryName,
      descriptions: product.descriptions,
    });

    const { vector, tokenCount } = await embedText(text);

    const { error: updateError } = await supabase
      .from('products')
      .update({ embedding: vector })
      .eq('id', productId)
      .eq('tenant_id', tenantId);

    if (updateError) throw new Error(updateError.message);

    await logAiUsage({
      tenantId,
      endpoint:     'embed-sync',
      provider:     'gemini',
      model:        EMBEDDING_MODEL,
      inputTokens:  tokenCount ?? undefined,
      outputTokens: 0,
      status:       'success',
    });
  } catch (err) {
    console.error('[embed-sync] Échec du recalcul d\'embedding:', err instanceof Error ? err.message : err);
    await logAiUsage({
      tenantId,
      endpoint: 'embed-sync',
      provider: 'gemini',
      model:    EMBEDDING_MODEL,
      status:   'error',
    });
  }
}
