import type { ProductFulfillmentPolicy } from '@lepefy/types';
import { createPublicClient } from '@/lib/supabase/public';
import { getShopCategories } from '@/lib/catalog/catalogCache';
import { PRODUCT_CARD_BASE_COLUMNS } from '@/lib/catalog/productCardSelect';
import { pickSellingFormatFields, type SellingFormatSource } from '@/lib/storefrontCopy/sellingFormat';
import { selectCardShowcase, type CardShowcaseReason } from './cardShowcase';

/** Projection envoyée au client : uniquement ce que la carte vitrine affiche. */
export interface CardShowcaseProduct extends SellingFormatSource {
  id: string;
  name: string;
  slug: string;
  price: number;
  compare_at_price: number | null;
  image_url: string;
  min_order_quantity: number;
  order_quantity_step: number;
  fulfillment_policy: ProductFulfillmentPolicy;
  reason: CardShowcaseReason;
}

type ShowcaseRow = Omit<CardShowcaseProduct, 'reason' | 'image_url'> & {
  image_url: string | null;
  stock: number | null;
  featured: boolean | null;
  position: number | null;
};

const CANDIDATES_PER_QUERY = 24;
const SHOWCASE_SELECT = `${PRODUCT_CARD_BASE_COLUMNS}, featured, position`;

/**
 * Produits de la vitrine /card, côté serveur et toujours scopés au tenant :
 * produits actifs des catégories boutique (`catalog_scope = 'shop'`, jamais
 * Goodies/événementiel). Trois lectures parallèles bornées (promotions, mis en
 * avant, ordre catalogue) puis choix pur `selectCardShowcase`. Toute erreur
 * vaut « aucun produit » : la page garde le simple lien boutique.
 */
export async function getCardShowcaseProducts(tenantId: string): Promise<CardShowcaseProduct[]> {
  try {
    const categoryIds = (await getShopCategories(tenantId)).map((category) => category.id);
    if (categoryIds.length === 0) return [];
    const supabase = createPublicClient();
    const base = () => supabase
      .from('products')
      .select(SHOWCASE_SELECT)
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .in('category_id', categoryIds)
      .not('image_url', 'is', null);
    const results = await Promise.all([
      base().not('compare_at_price', 'is', null).order('position').order('id').limit(CANDIDATES_PER_QUERY),
      base().eq('featured', true).order('position').order('id').limit(CANDIDATES_PER_QUERY),
      base().order('position').order('id').limit(CANDIDATES_PER_QUERY),
    ]);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);
    const rows = results.flatMap((result) => (result.data ?? []) as unknown as ShowcaseRow[]);
    return selectCardShowcase(rows.map((row) => ({
      ...row,
      price: Number(row.price),
      compare_at_price: row.compare_at_price == null ? null : Number(row.compare_at_price),
      min_order_quantity: row.min_order_quantity ?? 1,
      order_quantity_step: row.order_quantity_step ?? 1,
    }))).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      price: row.price,
      compare_at_price: row.showcaseReason === 'promo' ? row.compare_at_price : null,
      image_url: row.image_url as string,
      min_order_quantity: row.min_order_quantity,
      order_quantity_step: row.order_quantity_step,
      fulfillment_policy: row.fulfillment_policy ?? 'delivery_or_pickup',
      ...pickSellingFormatFields(row),
      reason: row.showcaseReason,
    }));
  } catch (error) {
    console.error('[card] showcase products unavailable:', error instanceof Error ? error.message : error);
    return [];
  }
}
