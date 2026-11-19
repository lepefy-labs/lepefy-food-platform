/**
 * Projection Supabase canonique pour toute requête `products` qui alimente
 * une carte produit (ProductCard, GoodiesHero, RelatedProducts, Nala…).
 *
 * Un seul endroit à modifier pour ajouter/retirer un champ affiché sur une
 * card — au lieu de répéter (et faire diverger) la même liste de colonnes
 * dans chaque page/route qui interroge `products`. `min_order_quantity` et
 * `order_quantity_step` (migration 121) sont volontairement dans cette
 * liste : toute card doit pouvoir afficher la règle de quantité minimale,
 * jamais la découvrir seulement à l'ajout au panier. Même raison pour
 * `fulfillment_policy` (migration 155) : « retrait uniquement » se voit sur la card.
 */
/** Colonnes du format de vente affiché au client (lib/storefrontCopy/sellingFormat.ts, migration 154). */
export const PRODUCT_SELLING_FORMAT_COLUMNS = 'net_quantity_display, sale_unit, net_content_value, net_content_unit, pack_count';

/** Fin de promotion programmée et nouveauté affichées sur les cards (migration 156). */
export const PRODUCT_HIGHLIGHT_COLUMNS = 'promo_applied, promo_ends_at, promo_until_sold_out, new_until';

/**
 * Formats de vente (migration 187) : libellé de la fiche + ses formats actifs
 * via la relation calculée `sale_formats` — dans la même requête que la card,
 * jamais une requête par card. Une fiche sans format renvoie `formats: []`.
 */
export const PRODUCT_SALE_FORMAT_COLUMNS =
  'format_parent_id, units_per_sale, format_label, format_stock_mode, formats:sale_formats(id, slug, name, price, compare_at_price, stock, active, min_order_quantity, order_quantity_step, weight_grams, format_parent_id, units_per_sale, format_label, format_position, format_stock_mode, promo_applied, promo_ends_at, promo_until_sold_out)';

/** Colonnes scalaires communes, sans la relation `category` (jointure dont la
 *  forme — `left join` ou `!inner` — varie selon l'appelant, cf. gadgets). */
export const PRODUCT_CARD_BASE_COLUMNS =
  `id, name, slug, price, compare_at_price, image_url, weight_grams, stock, storage_type, min_order_quantity, order_quantity_step, fulfillment_policy, ${PRODUCT_SELLING_FORMAT_COLUMNS}, ${PRODUCT_HIGHLIGHT_COLUMNS}, ${PRODUCT_SALE_FORMAT_COLUMNS}`;

export const PRODUCT_CARD_SELECT = `${PRODUCT_CARD_BASE_COLUMNS}, category:categories(name)`;
