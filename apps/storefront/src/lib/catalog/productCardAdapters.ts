import type { SemanticMatch } from '@lepefy/types';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';

/**
 * Adapte une ligne `match_products` (ricerca semantica) vers la forme
 * canonique `ProductCardProduct` — seul endroit où cette conversion existe,
 * pour que "Résultats similaires" (CatalogClient) affiche exactement les
 * mêmes informations (dont la règle de quantité minimale) que le reste du
 * catalogue, sans dupliquer de composant card dédié.
 */
export function semanticMatchToProductCardProduct(match: SemanticMatch): ProductCardProduct {
  return {
    id: match.id,
    name: match.name,
    slug: match.slug,
    price: match.price,
    compare_at_price: null,
    image_url: match.image_url,
    weight_grams: match.weight_grams,
    stock: match.stock,
    storage_type: match.storage_type,
    category: match.category_name ? { name: match.category_name } : null,
    min_order_quantity: match.min_order_quantity,
    order_quantity_step: match.order_quantity_step,
  };
}
