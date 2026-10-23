import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getShopCategories } from '@/lib/catalog/catalogCache';
import { getActivePromotions } from '@/lib/catalog/promotions';
import { catalogRankingDay, getCatalogPage } from '@/lib/catalog/pagination';
import { PRODUCT_CARD_SELECT } from '@/lib/catalog/productCardSelect';
import { orderExplicitRelationships } from '@/lib/catalog/productRelationships';
import { assembleCartSuggestions, CART_SUGGESTION_LIMIT, MAX_CART_SUGGESTION_LIMIT, parseCartProductIds } from '@/lib/cart/cartSuggestionRules';
import { getAddOnProducts } from '@/lib/catalog/addOnShelf';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';

export const dynamic = 'force-dynamic';

type CardRow = ProductCardProduct;

/**
 * « Complétez votre panier » : uniquement des données réelles du tenant, par
 * priorité — produits complémentaires déclarés par la boutique
 * (`product_relationships`, type `complementary`) pour les produits du panier
 * (ou pour `?anchor=` seul : le produit qui vient d'être ajouté, confirmation
 * d'ajout), « Petits plus » choisis par la boutique (`add_on_position`, 165 ;
 * `?only=add_ons` : eux seuls, pour la ligne du checkout),
 * promotions actives (`getActivePromotions`), meilleures ventes (classement
 * existant `sort=bestsellers`, qui retombe sur l'ordre du catalogue sans
 * données de vente). Produits de la boutique uniquement (pas les Goodies),
 * achetables (stock ≥ minimum), hors panier. Lignes produit lues fraîches
 * (prix et stock), projection des cartes. Une source en échec est sautée.
 */
export async function GET(req: NextRequest) {
  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const supabase = createClient();
    const categories = await getShopCategories(tenant.id).catch(() => []);
    const categoryIds = categories.map((category) => category.id);
    if (!categoryIds.length) return NextResponse.json({ products: [] });
    const cartIds = parseCartProductIds(req.nextUrl.searchParams.get('ids'));
    const anchor = parseCartProductIds(req.nextUrl.searchParams.get('anchor')).slice(0, 1);
    const requested = Number(req.nextUrl.searchParams.get('limit') ?? CART_SUGGESTION_LIMIT);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(MAX_CART_SUGGESTION_LIMIT, Math.floor(requested))) : CART_SUGGESTION_LIMIT;

    const [complementary, addOns, promotions, bestsellers] = await Promise.all([
      getComplementary(supabase, tenant.id, categoryIds, anchor.length ? anchor : cartIds).catch(() => []),
      getAddOnProducts<CardRow>(supabase, tenant.id, categoryIds).catch(() => []),
      getActivePromotions<CardRow>(supabase, tenant.id, categoryIds).catch(() => []),
      getCatalogPage(supabase, tenant.id, categories, { sort: 'bestsellers' }, 0, 24, catalogRankingDay())
        .then(({ data }) => (data ?? []) as CardRow[])
        .catch(() => []),
    ]);

    const onlyAddOns = req.nextUrl.searchParams.get('only') === 'add_ons';
    const sources = onlyAddOns ? [addOns] : [complementary, addOns, promotions, bestsellers];
    const products = assembleCartSuggestions(sources, [...cartIds, ...anchor], limit);
    return NextResponse.json({ products }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Section facultative : le panier ne dépend jamais de cette requête.
    return NextResponse.json({ products: [] }, { status: 503 });
  }
}

async function getComplementary(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  categoryIds: string[],
  cartIds: string[],
): Promise<CardRow[]> {
  if (!cartIds.length) return [];
  // Table réservée au service_role : lecture limitée au tenant et aux produits du panier.
  const { data: relations, error } = await createServiceClient()
    .from('product_relationships')
    .select('target_product_id, source, priority')
    .eq('tenant_id', tenantId)
    .eq('relationship_type', 'complementary')
    .eq('active', true)
    .in('source_product_id', cartIds);
  if (error || !relations?.length) return [];
  const ordered = orderExplicitRelationships(relations as Array<{ target_product_id: string; source: 'manual' | 'system'; priority: number }>);
  const targetIds = [...new Set(ordered.map((row) => row.target_product_id))];
  const { data: rows } = await supabase
    .from('products')
    .select(PRODUCT_CARD_SELECT)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('category_id', categoryIds)
    .in('id', targetIds);
  const byId = new Map(((rows ?? []) as unknown as CardRow[]).map((row) => [row.id, row]));
  return targetIds.map((id) => byId.get(id)).filter((row): row is CardRow => Boolean(row));
}

