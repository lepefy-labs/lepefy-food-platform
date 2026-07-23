import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { createPublicClient } from '@/lib/supabase/public';
import { ProductDetail } from '@/components/product/ProductDetail';
import { RelatedProducts } from '@/components/product/RelatedProducts';
import type { ProductWithCategory, SemanticMatch } from '@lepefy/types';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';

// ISR : ni cette page ni generateMetadata ne lisent de donnée personnalisée
// (pas de panier/session ici — ProductDetail lit le panier côté client via
// Zustand/localStorage). Stock et prix peuvent donc rester à 5 minutes de
// fraîcheur ; le re-contrôle réel se fait au checkout (cf. résumé du prompt).
export const revalidate = 300;

interface ProductPageProps { params: { slug: string } }

export async function generateStaticParams() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  try {
    const supabase = createPublicClient();
    const tenant = await getTenant(tenantSlug);
    const { data } = await supabase
      .from('products')
      .select('slug')
      .eq('tenant_id', tenant.id)
      .eq('active', true);
    return (data ?? []).map((p) => ({ slug: p.slug }));
  } catch (err) {
    // Vérifié empiriquement : une erreur non interceptée ici (Supabase
    // inatteignable pendant le build, tenant introuvable, etc.) fait
    // échouer TOUT `next build` — pas seulement cette page — ce qui
    // bloquerait un déploiement Vercel entier. On retombe sur [] : aucune
    // page pré-générée, mais dynamicParams reste true par défaut, donc
    // chaque /products/[slug] est quand même généré à la demande via l'ISR
    // (revalidate = 300) au premier accès.
    console.error('[products/[slug]] generateStaticParams a échoué, repli sur ISR à la demande :', err);
    return [];
  }
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createPublicClient();
  const { data } = await supabase.from('products').select('name, description')
    .eq('slug', params.slug).eq('tenant_id', tenant.id).single();
  if (!data) return {};
  return { title: data.name, description: data.description ?? undefined };
}

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
async function getRelatedProducts(
  supabase: ReturnType<typeof createPublicClient>,
  tenant: { id: string; ai_semantic_search?: boolean },
  product: { id: string; category_id: string | null },
): Promise<ProductCardProduct[]> {
  let candidates: ProductCardProduct[] = [];

  // 1) Similarité sémantique, si activée pour ce tenant
  if (tenant.ai_semantic_search) {
    const { data: embeddingRow } = await supabase
      .from('products')
      .select('embedding')
      .eq('id', product.id)
      .single();

    const embedding = parseEmbedding((embeddingRow as { embedding?: unknown } | null)?.embedding);

    if (embedding) {
      const { data: semantic, error } = await supabase.rpc('match_products', {
        query_embedding: embedding,
        p_tenant_id: tenant.id,
        match_count: RELATED_LIMIT + 1, // +1 : le produit lui-même ressort toujours comme meilleur match
        min_similarity: 0.35,
      });

      if (error) {
        console.error('[products/[slug]] match_products a échoué, repli sur la catégorie :', error.message);
      } else {
        candidates = ((semantic ?? []) as SemanticMatch[])
          .filter((p) => p.id !== product.id && p.stock !== 0)
          .map((p) => ({
            id:           p.id,
            name:         p.name,
            slug:         p.slug,
            price:        p.price,
            image_url:    p.image_url,
            weight_grams: p.weight_grams,
            stock:        p.stock,
            storage_type: p.storage_type,
            category:     p.category_name ? { name: p.category_name } : null,
          }));
      }
    }
  }

  // 2) Repli catégorie — complète jusqu'à RELATED_LIMIT si la sémantique est
  //    indisponible ou insuffisante
  if (candidates.length < RELATED_LIMIT) {
    const need = RELATED_LIMIT - candidates.length;
    const excludeIds = [product.id, ...candidates.map((c) => c.id)];

    let fallbackQuery = supabase
      .from('products')
      .select('id, name, slug, price, image_url, weight_grams, stock, storage_type, category:categories(name)')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
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

  return candidates.slice(0, RELATED_LIMIT);
}

export default async function ProductPage({ params }: ProductPageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createPublicClient();

  const { data: product } = await supabase
    .from('products')
    .select(`
      id, name, name_alt, slug, price, compare_at_price, image_url,
      weight_grams, stock, storage_type, category_id,
      description, descriptions,
      category:categories(name)
    `)
    .eq('slug', params.slug).eq('tenant_id', tenant.id).eq('active', true).single();

  if (!product) notFound();

  const related = await getRelatedProducts(supabase, tenant, product);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <ProductDetail product={product as unknown as ProductWithCategory} />
      <RelatedProducts products={related} />
    </div>
  );
}
