import type { createPublicClient } from '@/lib/supabase/public';
import type { SemanticMatch } from '@lepefy/types';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';
import { PRODUCT_CARD_SELECT } from '@/lib/catalog/productCardSelect';

// Server utility: imported only by the product page and public recommendation route.
const RELATED_LIMIT = 8;

/**
 * L'embedding pgvector revient de Supabase soit déjà comme number[], soit
 * comme chaîne "[0.1,0.2,...]" selon le driver/la version du client — cf.
 * note de rapport. `match_products` attend un vector(768) ; on normalise
 * ici pour ne jamais lui passer une chaîne brute.
 */
function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Produits similaires : priorité à la similarité sémantique (embedding déjà
 * calculé pour chaque produit — aucun appel Gemini supplémentaire ici),
 * repli sur la même catégorie si le tenant n'a pas activé la recherche
 * sémantique, si le produit n'a pas encore d'embedding, ou si l'appel RPC
 * échoue. Les produits épuisés sont exclus entièrement (pas juste
 * dépriorisés) : avec un catalogue de la taille de ChloeFood, un slot gâché
 * sur un produit non achetable coûte plus qu'il n'apporte.
 *
 * L'embedding du produit courant est récupéré via une requête séparée
 * (et jamais transmis au composant client ProductDetail) : c'est un
 * vector(768), inutile de le faire transiter dans le payload RSC envoyé
 * au navigateur.
 */
export async function getRelatedProducts(
  supabase: ReturnType<typeof createPublicClient>,
  tenant: { id: string; ai_semantic_search?: boolean },
  product: { id: string; category_id: string | null },
  requestedLimit = RELATED_LIMIT,
): Promise<ProductCardProduct[]> {
  const limit = Math.min(RELATED_LIMIT, Math.max(1, Math.floor(requestedLimit) || RELATED_LIMIT));
  let candidates: ProductCardProduct[] = [];

  // 1) Similarité sémantique, si activée pour ce tenant
  if (tenant.ai_semantic_search) {
    const { data: embeddingRow } = await supabase
      .from('products')
      .select('embedding')
      .eq('id', product.id)
      .eq('tenant_id', tenant.id)
      .eq('active', true).is('format_parent_id', null)
      .single();

    const embedding = parseEmbedding((embeddingRow as { embedding?: unknown } | null)?.embedding);

    if (embedding) {
      const { data: semantic, error } = await supabase.rpc('match_products', {
        query_embedding: embedding,
        p_tenant_id: tenant.id,
        match_count: limit + 1, // +1 : le produit lui-même ressort toujours comme meilleur match
        min_similarity: 0.35,
      });

      if (error) {
        console.error('[products/[slug]] match_products a échoué, repli sur la catégorie :', error.message);
      } else {
        // L'ordre vient de la similarité ; les données de la card viennent de la
        // projection partagée (formats de vente compris), comme le repli
        // catégorie : deux cards du même carrousel se comportent pareil.
        const ids = ((semantic ?? []) as SemanticMatch[])
          .filter((p) => p.id !== product.id && p.stock !== 0)
          .map((p) => p.id);
        if (ids.length > 0) {
          const { data: cards, error: cardsError } = await supabase
            .from('products')
            .select(PRODUCT_CARD_SELECT)
            .eq('tenant_id', tenant.id)
            .eq('active', true).is('format_parent_id', null)
            .neq('stock', 0)
            .in('id', ids);
          if (cardsError) {
            console.error('[products/[slug]] lecture des cards similaires a échoué, repli sur la catégorie :', cardsError.message);
          } else {
            const byId = new Map(((cards ?? []) as unknown as ProductCardProduct[]).map((card) => [card.id, card]));
            candidates = ids.map((id) => byId.get(id)).filter((card): card is ProductCardProduct => Boolean(card));
          }
        }
      }
    }
  }

  // 2) Repli catégorie — complète jusqu'à RELATED_LIMIT si la sémantique est
  //    indisponible ou insuffisante
  if (candidates.length < limit) {
    const need = limit - candidates.length;
    const excludeIds = [product.id, ...candidates.map((c) => c.id)];

    let fallbackQuery = supabase
      .from('products')
      .select(PRODUCT_CARD_SELECT)
      .eq('tenant_id', tenant.id)
      .eq('active', true).is('format_parent_id', null)
      .neq('stock', 0)
      .not('id', 'in', `(${excludeIds.join(',')})`)
      .order('position', { ascending: true })
      .limit(need);

    if (product.category_id) {
      fallbackQuery = fallbackQuery.eq('category_id', product.category_id);
    }

    const { data: fallback } = await fallbackQuery;
    candidates = [...candidates, ...((fallback ?? []) as unknown as ProductCardProduct[])];
  }

  return candidates.slice(0, limit);
}
