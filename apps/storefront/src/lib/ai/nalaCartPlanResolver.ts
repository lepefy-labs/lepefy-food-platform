import type { SupabaseClient } from '@supabase/supabase-js';
import { embedTexts } from '@/lib/ai/embeddings';
import {
  finalizeNalaCartPlan,
  selectNalaCartPlanItem,
  type CartIngredientCandidate,
  type NalaCartPlan,
  type NalaCartPlanExtraction,
} from '@/lib/ai/nalaCartPlanContract';
import type { NalaCanonicalProduct } from '@/lib/ai/nalaProductActionContract';
import { getRelatedProducts } from '@/lib/catalog/productRelationships';

interface MatchProductsRow {
  id: string;
  tenant_id?: string;
  name: string;
  slug: string;
  image_url: string | null;
  price: number;
  compare_at_price?: number | null;
  category_id: string | null;
  stock: number;
  active?: boolean;
  weight_grams: number | null;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  similarity: number;
}

function toCanonical(
  row: MatchProductsRow,
  tenantId: string,
  quantityRuleById: Map<string, { min_order_quantity: number; order_quantity_step: number }>,
): NalaCanonicalProduct & { category_id: string | null } {
  const quantityRule = quantityRuleById.get(row.id);
  return {
    id: row.id,
    tenant_id: row.tenant_id ?? tenantId,
    category_id: row.category_id,
    name: row.name,
    slug: row.slug,
    image_url: row.image_url,
    price: Number(row.price),
    compare_at_price: row.compare_at_price ?? null,
    stock: Number(row.stock),
    active: row.active !== false,
    weight_grams: row.weight_grams,
    storage_type: row.storage_type,
    min_order_quantity: quantityRule?.min_order_quantity ?? 1,
    order_quantity_step: quantityRule?.order_quantity_step ?? 1,
  };
}

export async function resolveCartPlanIngredients(params: {
  supabase: SupabaseClient;
  tenantId: string;
  interactionId: string;
  extraction: NalaCartPlanExtraction;
  currency: string;
  locale: unknown;
}): Promise<{ plan: NalaCartPlan; tokenCount: number }> {
  const ingredients = params.extraction.ingredients.slice(0, 8);
  const { vectors, tokenCount } = await embedTexts(ingredients.map((ingredient) => ingredient.name));

  const matchResults = await Promise.all(vectors.map((vector) => params.supabase.rpc('match_products', {
    query_embedding: vector,
    p_tenant_id: params.tenantId,
    match_count: 4,
    min_similarity: 0.42,
  })));

  // match_products() ne renvoie pas les règles de quantité minimale — un
  // second aller simple les récupère pour tous les candidats en une fois,
  // sans toucher à la fonction SQL (cf. purchaseQuantityRules.ts).
  const allCandidateIds = [...new Set(
    matchResults.flatMap((result) => (result?.error ? [] : (result?.data ?? []) as MatchProductsRow[]))
      .map((row) => row.id),
  )];
  const quantityRuleById = new Map<string, { min_order_quantity: number; order_quantity_step: number }>();
  if (allCandidateIds.length > 0) {
    const { data: quantityRuleRows } = await params.supabase
      .from('products')
      .select('id, min_order_quantity, order_quantity_step')
      .in('id', allCandidateIds);
    for (const row of (quantityRuleRows ?? []) as Array<{ id: string; min_order_quantity: number; order_quantity_step: number }>) {
      quantityRuleById.set(row.id, { min_order_quantity: row.min_order_quantity, order_quantity_step: row.order_quantity_step });
    }
  }

  const items = await Promise.all(ingredients.map(async (ingredient, index) => {
    const result = matchResults[index];
    const rows = result?.error ? [] : (result?.data ?? []) as MatchProductsRow[];
    const directCandidates: CartIngredientCandidate[] = rows.map((row) => ({
      product: toCanonical(row, params.tenantId, quantityRuleById),
      similarity: Number(row.similarity),
    }));

    const strongAnchor = directCandidates.find((candidate) => (
      Number.isFinite(candidate.similarity) && candidate.similarity >= 0.55
    ));
    const hasPurchasableDirect = directCandidates.some((candidate) => (
      candidate.similarity >= 0.55
      && candidate.product.tenant_id === params.tenantId
      && candidate.product.active
      // Stock insuffisant pour atteindre le minimum de vente : chercher un
      // substitut plutôt que proposer une quantité que le checkout rejettera.
      && candidate.product.stock >= (candidate.product.min_order_quantity ?? 1)
    ));

    let substitute = null;
    if (strongAnchor && !hasPurchasableDirect) {
      const [resolved] = await getRelatedProducts({
        supabase: params.supabase,
        tenantId: params.tenantId,
        sourceProductId: strongAnchor.product.id,
        type: 'substitute',
        limit: 1,
        allowSemanticFallback: true,
      });
      substitute = resolved ? {
        product: resolved.product,
        source: resolved.source,
        similarity: resolved.similarity,
      } : null;
    }

    return selectNalaCartPlanItem({
      tenantId: params.tenantId,
      ingredient,
      currency: params.currency,
      directCandidates,
      substitute,
    });
  }));

  return {
    plan: finalizeNalaCartPlan({
      id: crypto.randomUUID(),
      interactionId: params.interactionId,
      title: params.extraction.title,
      items,
      currency: params.currency,
      locale: params.locale,
    }),
    tokenCount,
  };
}
